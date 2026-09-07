/**
 * Repo-wide guard (U9): EVERY CDK app entrypoint attaches the advisory cdk-nag security review.
 *
 * | Invariant                                                                    | Test                                                            |
 * | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
 * | Discovery finds every CDK app in the repo (the walk itself is not broken)      | 'discovers every CDK app entrypoint in the repo'                 |
 * | Each entrypoint imports the shared helper — not a hand-rolled Aspect           | '… imports attachSecurityChecks from @kitchensink/infra-security'|
 * | Each entrypoint actually CALLS it on its own `App`                            | '… calls attachSecurityChecks(app)'                             |
 * | Nobody attaches `AwsSolutionsChecks` directly (bypassing advisory mode)        | '… never attaches a raw AwsSolutionsChecks'                     |
 * | The import resolves at synth/deploy time                                      | '… declares @kitchensink/infra-security as a dependency'        |
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

const SECURITY_PACKAGE = '@kitchensink/infra-security';
const ATTACH_FUNCTION = 'attachSecurityChecks';

/** The CDK apps that exist today. Pins the walk below against silently matching nothing. */
const KNOWN_ENTRYPOINTS = [
    'packages/apps/commise/web/infra/bin/app.ts',
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

    it.each(cases)('%s imports attachSecurityChecks from @kitchensink/infra-security', (_entrypoint, app) => {
        expect(importsNamed(app.nodes, SECURITY_PACKAGE, ATTACH_FUNCTION)).toBe(true);
    });

    it.each(cases)('%s calls attachSecurityChecks(app)', (_entrypoint, app) => {
        expect(callsWith(app.nodes, ATTACH_FUNCTION, 'app')).toBe(true);
    });

    it.each(cases)('%s never attaches a raw AwsSolutionsChecks', (_entrypoint, app) => {
        // The stock pack fails synth on ERROR-level findings; only the advisory wrapper may be used.
        expect(constructs(app.nodes, 'AwsSolutionsChecks')).toBe(false);
    });

    it.each([...new Set(cdkApps.map((app) => app.packageDir))].map((dir) => [dir] as const))(
        '%s declares @kitchensink/infra-security as a dependency',
        (packageDir) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, packageDir, 'package.json'), 'utf8'));
            const declared = { ...manifest.dependencies, ...manifest.devDependencies };

            expect(Object.keys(declared)).toContain(SECURITY_PACKAGE);
        },
    );
});
