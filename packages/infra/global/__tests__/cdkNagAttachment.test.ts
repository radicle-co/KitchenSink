/**
 * Repo-wide guard (U9): EVERY CDK app entrypoint attaches the advisory cdk-nag security review.
 *
 * | Invariant                                                                    | Test                                                            |
 * | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
 * | Discovery finds every CDK app in the repo (the walk itself is not broken)      | 'discovers every CDK app entrypoint in the repo'                 |
 * | Each entrypoint imports the shared helper — not a hand-rolled Aspect           | '… imports attachSecurityChecks from @radicle-co/infra-shared/security'|
 * | Each entrypoint actually CALLS it on its own `App`                            | '… calls attachSecurityChecks(app)'                             |
 * | Nobody attaches `AwsSolutionsChecks` directly (bypassing advisory mode)        | '… never attaches a raw AwsSolutionsChecks'                     |
 * | The import resolves at synth/deploy time                                      | '… declares @radicle-co/infra-shared/security as a dependency'        |
 *
 * WHY discovery rather than a hardcoded list: the failure this guards against is a NEW CDK app landing
 * with no security review at all. A hardcoded list would pass forever while coverage silently rotted, so
 * the suite walks the workspace for CDK apps and asserts on whatever it finds — while ALSO pinning the
 * currently-known set, so a broken walk that finds nothing cannot pass (mutation-verified: breaking the
 * `new App(...)` predicate fails 'discovers every CDK app entrypoint').
 *
 * WHY the TypeScript AST and not a regex: the first version of this guard matched the source text, and a
 * mutation that merely COMMENTED OUT `attachSecurityChecks(app);` still passed — the regex happily matched
 * inside the comment. Parsing with the real compiler makes the assertion about the code that runs, so a
 * commented-out, stringified or renamed call cannot satisfy it.
 *
 * WHY 'never attaches a raw AwsSolutionsChecks': the stock pack raises ERROR-level annotations, and the
 * CDK CLI exits 1 when one is present. Attaching it directly would convert the advisory backlog into a
 * hard deploy gate on live infrastructure — the exact outcome advisory-first mode exists to avoid.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it, expect } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// ⛔ ONE SPELLING. The migration is complete: `packages/infra/{alb,messaging,security}` are deleted and the
// shared constructs live only in `@radicle-co/infra-shared`. The transitional allowance for either specifier
// is gone, so this is back to asserting exactly one import — never a hand-rolled Aspect.
const SECURITY_PACKAGES = ['@radicle-co/infra-shared/security'] as const;

/** The package whose manifest must declare the security module, for each accepted specifier. */
const SECURITY_DECLARATIONS = ['@radicle-co/infra-shared'] as const;

/**
 * The manifest that GOVERNS a CDK app — the nearest `package.json` at or above its entrypoint.
 *
 * ⛔ Not the service's manifest. A CDK app whose `infra/` directory carries its own `package.json` installs
 * its dependencies there, deliberately outside the workspace, and the service manifest then declares none of
 * them. Reading the service manifest would report that app as undeclared while it is in fact declared one
 * directory down — and reading only the infra manifest would break every app that has not moved.
 *
 * @param entrypoint - Repo-relative path to the app's `bin/app.ts`.
 * @param packageDir - The workspace directory the app belongs to.
 * @returns Repo-relative path of the manifest that declares this app's dependencies.
 * @sideEffect Reads the working tree.
 */
function governingManifest(entrypoint: string, packageDir: string): string {
    let dir = path.dirname(path.join(repoRoot, entrypoint));
    const stop = path.join(repoRoot, packageDir);

    while (dir.startsWith(stop)) {
        const candidate = path.join(dir, 'package.json');

        if (existsSync(candidate)) {
            return path.relative(repoRoot, candidate);
        }

        dir = path.dirname(dir);
    }

    return path.join(packageDir, 'package.json');
}

const ATTACH_FUNCTION = 'attachSecurityChecks';

/** The CDK apps that exist today. Pins the walk below against silently matching nothing. */
const KNOWN_ENTRYPOINTS = [
    'packages/apps/commise/web/infra/bin/app.ts',
    // The ACCOUNT-scoped app: one budget and one anomaly monitor for the whole AWS account, with no stage
    // at all. Separate from `bin/app.ts` beside it, which owns the per-STAGE shared platform — two kinds of
    // "global" that used to be one app, which is how an account-wide stack ended up reachable only by
    // deploying production.
    'packages/infra/global/bin/account.ts',
    'packages/infra/global/bin/app.ts',
    'packages/services/food-service/infra/bin/app.ts',
    'packages/services/identity-webhooks/infra/bin/app.ts',
    'packages/services/identity/infra/bin/app.ts',
    'packages/services/ingredient-parser/infra/bin/app.ts',
    'packages/services/recipe-service/infra/bin/app.ts',
    'packages/services/recipe-workers/infra/bin/app.ts',
];

/** Every workspace package directory (repo-relative), matching the root `workspaces` globs. */
function workspaceDirs(): string[] {
    const bases = [
        'packages/apps/commise',
        'packages/apps/commise/features',
        'packages/clients',
        'packages/infra',
        'packages/services',
        'packages/shared',
        'packages/tools',
        'packages/utils',
    ];
    const dirs: string[] = [];

    for (const base of bases) {
        const baseDir = path.join(repoRoot, base);

        if (!existsSync(baseDir)) {
            continue;
        }

        for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
            if (entry.isDirectory() && existsSync(path.join(baseDir, entry.name, 'package.json'))) {
                dirs.push(path.posix.join(base, entry.name));
            }
        }
    }

    return dirs;
}

/** Every `.ts` file under a package's `bin/` or `infra/bin/` directory. */
function binFiles(packageDir: string): string[] {
    const files: string[] = [];

    for (const dir of [path.join(packageDir, 'bin'), path.join(packageDir, 'infra', 'bin')]) {
        const absolute = path.join(repoRoot, dir);

        if (!existsSync(absolute)) {
            continue;
        }

        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.ts')) {
                files.push(path.posix.join(dir, entry.name));
            }
        }
    }

    return files;
}

/** Every node of the parsed file, depth-first. */
function nodesOf(source: ts.SourceFile): ts.Node[] {
    const nodes: ts.Node[] = [];

    const visit = (node: ts.Node): void => {
        nodes.push(node);
        ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);

    return nodes;
}

/** True when the file contains `new <className>(…)` as real code (not in a comment or a string). */
function constructs(nodes: readonly ts.Node[], className: string): boolean {
    return nodes.some(
        (node) => ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === className,
    );
}

/** True when the file calls `<functionName>(<argumentName>)` as real code. */
function callsWith(nodes: readonly ts.Node[], functionName: string, argumentName: string): boolean {
    return nodes.some(
        (node) =>
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === functionName &&
            node.arguments.length === 1 &&
            ts.isIdentifier(node.arguments[0]!) &&
            (node.arguments[0] as ts.Identifier).text === argumentName,
    );
}

/** True when the file has a real named import of `<binding>` from `<moduleSpecifier>`. */
function importsNamed(nodes: readonly ts.Node[], moduleSpecifier: string, binding: string): boolean {
    return nodes.some((node) => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
            return false;
        }

        if (node.moduleSpecifier.text !== moduleSpecifier) {
            return false;
        }

        const bindings = node.importClause?.namedBindings;

        return (
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.some((element) => element.name.text === binding)
        );
    });
}

interface CdkApp {
    /** Repo-relative path to the entrypoint. */
    readonly entrypoint: string;
    /** Repo-relative path to the owning workspace package. */
    readonly packageDir: string;
    readonly nodes: ts.Node[];
}

/** Every discovered CDK app entrypoint: a file under some `bin/` that constructs a CDK `App`. */
function discoverCdkApps(): CdkApp[] {
    return workspaceDirs()
        .flatMap((packageDir) =>
            binFiles(packageDir).map((entrypoint) => ({
                entrypoint,
                packageDir,
                nodes: nodesOf(
                    ts.createSourceFile(
                        entrypoint,
                        readFileSync(path.join(repoRoot, entrypoint), 'utf8'),
                        ts.ScriptTarget.ESNext,
                        true,
                    ),
                ),
            })),
        )
        .filter((app) => constructs(app.nodes, 'App'))
        .sort((a, b) => a.entrypoint.localeCompare(b.entrypoint));
}

const cdkApps = discoverCdkApps();
const cases = cdkApps.map((app) => [app.entrypoint, app] as const);

describe('cdk-nag is attached to every CDK app entrypoint (U9)', () => {
    it('discovers every CDK app entrypoint in the repo', () => {
        // If the walk breaks, every per-app assertion below vacuously passes — so pin the set.
        expect(cdkApps.map((app) => app.entrypoint)).toEqual(KNOWN_ENTRYPOINTS);
    });

    it.each(cases)('%s imports attachSecurityChecks from the shared security module', (_entrypoint, app) => {
        expect(SECURITY_PACKAGES.some((pkg) => importsNamed(app.nodes, pkg, ATTACH_FUNCTION))).toBe(true);
    });

    it.each(cases)('%s calls attachSecurityChecks(app)', (_entrypoint, app) => {
        expect(callsWith(app.nodes, ATTACH_FUNCTION, 'app')).toBe(true);
    });

    it.each(cases)('%s never attaches a raw AwsSolutionsChecks', (_entrypoint, app) => {
        // The stock pack fails synth on ERROR-level findings; only the advisory wrapper may be used.
        expect(constructs(app.nodes, 'AwsSolutionsChecks')).toBe(false);
    });

    it.each(cdkApps.map((app) => [governingManifest(app.entrypoint, app.packageDir)] as const))(
        '%s declares the shared security module as a dependency',
        (manifestPath) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

            expect(SECURITY_DECLARATIONS.some((pkg) => declared.includes(pkg))).toBe(true);
        },
    );
});
