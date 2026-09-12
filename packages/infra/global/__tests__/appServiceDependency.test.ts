/**
 * Repo-wide guard: NO app may depend on a deployable SERVICE package — not in its manifest, not in a
 * source file, not even type-only.
 *
 * WHY THIS EXISTS. `packages/services/*` are NestJS/Lambda services: their dependency graphs carry
 * `drizzle-orm`, `pg`, the AWS SDK and `@sentry/nestjs`. The wire types an app needs are published
 * separately as the generated leaf schema packages (`@kitchensink/schema-identity` and siblings, whose only
 * dependency is `zod` — `docs/CODING_STANDARDS.md` §15.2). Web and mobile nonetheless declared
 * `@kitchensink/identity-service` and imported types from it in nine source files, which is the dependency
 * INVERSION §15.2's leaf packages exist to remove.
 *
 * WHY A TEST AND NOT THE RATCHET. `scripts/boundariesRatchet.mjs` reports UNDECLARED dependencies. These
 * were declared, so it was structurally blind to them — and so was every other gate. The edges were
 * type-only, so nothing broke and nothing bundled; the exposure is that the next non-type import from any of
 * those files silently drags a server package into the React Native bundle, with no gate to catch it. That
 * is exactly the failure that is cheap to prevent and expensive to discover, so the boundary is asserted
 * statically here rather than trusted to review. TYPE-ONLY IMPORTS COUNT AS VIOLATIONS on purpose: `import
 * type` is one keyword away from a runtime import, and the keyword is not what the boundary should rest on.
 *
 * The service list is DISCOVERED, not enumerated, so a new service under `packages/services/` is covered the
 * day it is created rather than the day someone remembers to add it here. Files come from `git ls-files`,
 * which keeps build output (`.next/`, `dist/`, `cdk.out/`) out of the scan — the same trap documented at
 * length in `scripts/boundariesRatchet.mjs`.
 *
 * The published leaf is what apps SHOULD use, so this file also asserts that leaf is real: a rule that only
 * forbids has nowhere to send the next engineer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it, expect } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Where the apps live. Every manifest and source file under here is subject to the rule. */
const APPS_ROOT = 'packages/apps';

/** Where the deployable services live — the package names an app must never name. */
const SERVICES_ROOT = 'packages/services';

/** The manifest sections that create a dependency edge. `peerDependencies` included: it is still an edge. */
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Source extensions worth scanning for import/export specifiers. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

interface Manifest {
    readonly name?: string;
    readonly [section: string]: unknown;
}

/**
 * Read and parse a JSON manifest, or `undefined` when it cannot be read.
 *
 * @param relativePath - Repo-relative path to the manifest.
 * @returns The parsed manifest, or `undefined`.
 * @sideEffect Reads from disk.
 */
function readManifest(relativePath: string): Manifest | undefined {
    try {
        return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as Manifest;
    } catch {
        return undefined;
    }
}

/**
 * Every deployable service's package name, discovered from `packages/services/*`.
 *
 * @returns The service package names.
 * @sideEffect Reads the services directory and its manifests.
 */
function servicePackageNames(): readonly string[] {
    const servicesDir = path.join(repoRoot, SERVICES_ROOT);
    const names: string[] = [];

    for (const entry of readdirSync(servicesDir, { withFileTypes: true })) {
        const manifestPath = path.posix.join(SERVICES_ROOT, entry.name, 'package.json');

        if (!entry.isDirectory() || !existsSync(path.join(repoRoot, manifestPath))) {
            continue;
        }

        const name = readManifest(manifestPath)?.name;

        if (typeof name === 'string') {
            names.push(name);
        }
    }

    return names;
}

/**
 * Every tracked file under a repo-relative directory that is ALSO present in the working tree.
 *
 * `git ls-files` (rather than a directory walk) so gitignored build output — `.next/standalone`, `dist/`,
 * `cdk.out/` — can never contribute a finding: that trap is documented at length in
 * `scripts/boundariesRatchet.mjs`, where a stray `cdk synth` invented three phantom violations.
 *
 * The `existsSync` filter is NOT redundant, and was added after this suite crashed on `ENOENT`: `ls-files`
 * reports the INDEX, which routinely disagrees with the working tree — a deletion that is not yet staged, a
 * `git reset` that un-staged one that was, a half-finished rebase or a sparse checkout all leave an index
 * entry with no file behind it. A gate that throws in those states is a gate that fails for reasons having
 * nothing to do with what it checks. Skipping is also the CORRECT reading, not a shortcut: a file that is not
 * there imports nothing.
 *
 * @param relativeDir - Repo-relative directory to list.
 * @returns Repo-relative paths of the tracked, on-disk files.
 * @sideEffect Shells out to git and stats the working tree.
 */
function trackedFiles(relativeDir: string): readonly string[] {
    return execFileSync('git', ['ls-files', '--', relativeDir], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((file) => file.length > 0 && existsSync(path.join(repoRoot, file)));
}

const services = servicePackageNames();
const appFiles = trackedFiles(APPS_ROOT);
const appManifests = appFiles.filter((file) => path.basename(file) === 'package.json');
const appSources = appFiles.filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file)));

/**
 * Every module specifier a source file actually imports, exports from, or `require`s — PARSED with the
 * TypeScript compiler rather than pattern-matched.
 *
 * Textual matching was tried first and was wrong in the direction that matters: `profileServiceClient.ts`
 * carries the doc comment `import type { UserProfile } from '@kitchensink/identity-service'` — the very
 * prose explaining that this edge was REMOVED — and a regex reported it as a violation. A gate that fires on
 * its own rationale gets deleted. The compiler's parser sees comments and string literals for what they are,
 * so this cannot report prose, and equally cannot MISS an unusual-but-real form.
 *
 * Covers: static `import`/`export … from`, side-effect `import '…'`, `import type`, dynamic `import()`,
 * `import('…').Type` type nodes, and `require('…')`.
 *
 * @param file - Repo-relative path (drives the .tsx vs .ts parse mode).
 * @param contents - The file's source text.
 * @returns The module specifiers, in source order, with duplicates preserved.
 */
function moduleSpecifiers(file: string, contents: string): readonly string[] {
    const extension = path.extname(file);
    const source = ts.createSourceFile(
        file,
        contents,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const specifiers: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        }

        if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
        ) {
            specifiers.push(node.argument.literal.text);
        }

        if (ts.isCallExpression(node) && node.arguments.length > 0) {
            const callee = node.expression;
            const isModuleLoad =
                callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
            const [first] = node.arguments;

            if (isModuleLoad && first !== undefined && ts.isStringLiteral(first)) {
                specifiers.push(first.text);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return specifiers;
}

/**
 * Whether a module specifier resolves to `pkg` — the package itself or one of its subpath exports. Pure.
 *
 * @param specifier - The module specifier from source.
 * @param pkg - The package name.
 * @returns `true` when the specifier names that package.
 */
function targets(specifier: string, pkg: string): boolean {
    return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

describe('apps must not depend on a deployable service package', () => {
    // A guard on the guard: if service discovery ever yields nothing, every assertion below passes
    // vacuously. Anchored to the services known to exist so an empty or renamed tree is a failure.
    it('discovers the deployable service packages it is meant to forbid', () => {
        expect(services).toContain('@kitchensink/identity-service');
        expect(services.length).toBeGreaterThanOrEqual(4);
    });

    it('scans a plausible number of app manifests and sources', () => {
        expect(appManifests.length).toBeGreaterThanOrEqual(4);
        expect(appSources.length).toBeGreaterThanOrEqual(100);
    });

    it('declares no service package in any packages/apps manifest', () => {
        const violations: string[] = [];

        for (const manifest of appManifests) {
            const parsed = readManifest(manifest);

            if (parsed === undefined) {
                throw new Error(`unreadable app manifest: ${manifest}`);
            }

            for (const section of DEPENDENCY_SECTIONS) {
                const deps = parsed[section];

                if (deps === null || typeof deps !== 'object') {
                    continue;
                }

                for (const dep of Object.keys(deps as Record<string, unknown>)) {
                    if (services.includes(dep)) {
                        violations.push(`${manifest} → ${section}.${dep}`);
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('imports no service package from any packages/apps source file, type-only included', () => {
        const violations: string[] = [];

        for (const file of appSources) {
            const specifiers = moduleSpecifiers(file, readFileSync(path.join(repoRoot, file), 'utf8'));

            for (const service of services) {
                if (specifiers.some((specifier) => targets(specifier, service))) {
                    violations.push(`${file} → ${service}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    // The scanner's own correctness, on fixtures rather than on the tree: an `import type` IS a violation
    // (the boundary must not rest on one keyword), a subpath import IS one, and the same package name inside
    // a comment or an unrelated string is NOT — the false positive that the first, textual version of this
    // gate produced against `profileServiceClient.ts`'s explanatory doc comment.
    it('detects real specifiers of every form, and does not report prose that quotes one', () => {
        const forbidden = '@kitchensink/identity-service';
        const detected = (source: string): boolean =>
            moduleSpecifiers('fixture.ts', source).some((specifier) => targets(specifier, forbidden));

        expect(detected(`import type { UserProfile } from '${forbidden}';`)).toBe(true);
        expect(detected(`import { thing } from '${forbidden}/types';`)).toBe(true);
        expect(detected(`export type { UserStatus } from '${forbidden}';`)).toBe(true);
        expect(detected(`import '${forbidden}';`)).toBe(true);
        expect(detected(`const m = await import('${forbidden}');`)).toBe(true);
        expect(detected(`const m = require('${forbidden}');`)).toBe(true);
        expect(detected(`type T = import('${forbidden}').UserProfile;`)).toBe(true);

        expect(detected(`/** Was: import x from '${forbidden}' — now the schema leaf. */ export const a = 1;`)).toBe(
            false,
        );
        expect(detected(`// import type { X } from '${forbidden}';`)).toBe(false);
        expect(detected(`export const doc = "from '${forbidden}'";`)).toBe(false);
        expect(detected(`import type { UserProfile } from '@kitchensink/schema-identity';`)).toBe(false);
        expect(detected(`import { Client } from '@kitchensink/identity-service-client';`)).toBe(false);
    });

    // Where the wire types DO come from. Asserted so the rule above stays actionable.
    it('publishes the identity wire contract as a leaf package apps may depend on', () => {
        const leaf = readManifest('packages/schemas/identity/package.json');

        expect(leaf?.name).toBe('@kitchensink/schema-identity');
        expect(Object.keys((leaf?.['dependencies'] ?? {}) as Record<string, unknown>)).toEqual(['zod']);
    });
});
