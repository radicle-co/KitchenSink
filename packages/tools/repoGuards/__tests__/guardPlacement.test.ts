// @vitest-environment node
/**
 * Repo-wide guard: **a test lives in `packages/infra/global` only when it reaches infrastructure code**, and every other
 * repo-wide guard lives here (ADR-0066). The rule is reach, not topic: a guard that reads infra source only as text
 * belongs here.
 *
 * Both directions are checked, because the defect this closes was a direction-two miss. `packages/infra/global` held
 * about 260 repo-wide guards (code standards, docs, CI wiring) because it was the one package whose tests could read the
 * whole repository, so every new guard was added there whatever its subject.
 *
 * - **Here:** no file in this package reaches infrastructure code: the CDK packages, infra-global's `lib/`, `src/` or
 *   `bin/`, or any package's `infra/` code.
 * - **Infra:** every test file in `packages/infra/global` reaches it, through its imports or a file-path literal into
 *   that code. A file whose reach is a child process or a file read that names no path is in {@link RUNTIME_REACH},
 *   with its reason; the suites under `tests/deployed/` verify the deployed infrastructure and stay by their tier. A
 *   local helper those suites are built on is infra code too, so the helper's own unit test stays beside it.
 * - **Helpers here are used here:** a helper this package exports to infra has an importer here other than its own unit
 *   test. A helper only infra uses belongs in infra.
 *
 * "Reach" is read from the TypeScript AST and follows local imports transitively, so a string that merely contains
 * `aws-cdk-lib`, as fixture text often does, does not count.
 *
 * @pattern Fitness Function over the test packages' module graph
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The repo root — this file sits at `packages/tools/repoGuards/__tests__/`. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const INFRA = 'packages/infra/global';
const GUARDS = 'packages/tools/repoGuards';

/** The CDK libraries themselves. */
const CDK_LIBRARIES = ['aws-cdk-lib', 'constructs', 'cdk-nag'];

/**
 * Every tracked package that depends on a CDK library, by name: the CDK apps and the shared constructs. Discovered, so a
 * new CDK package is covered the day it lands.
 *
 * @sideEffect Runs `git ls-files` and reads the manifests.
 */
function cdkPackageNames(): readonly string[] {
    return execFileSync('git', ['ls-files', '--', '*package.json'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules/'))
        .flatMap((file) => {
            const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')) as {
                readonly name?: string;
                readonly dependencies?: Record<string, string>;
                readonly devDependencies?: Record<string, string>;
            };
            const depends = { ...manifest.dependencies, ...manifest.devDependencies };

            return manifest.name !== undefined && CDK_LIBRARIES.some((library) => library in depends)
                ? [manifest.name]
                : [];
        });
}

/** Packages whose import makes a file a test of infrastructure. */
const INFRA_PACKAGES = new Set([...CDK_LIBRARIES, ...cdkPackageNames()]);

/** Infrastructure code: infra-global's own code, and the `infra/` code of every other package. */
const INFRA_CODE = /(?:^packages\/infra\/global\/(?:lib|src|bin)\/)|\/infra\/(?:lib|src|bin)\//u;

/**
 * Infra-global files whose reach an import graph cannot see, each with the reason. A file here that already reaches
 * infrastructure through its imports fails the guard, so the register cannot outlive its need.
 */
const RUNTIME_REACH: Readonly<Record<string, string>> = {
    'tests/accountAppQualifier.integration.test.ts': 'synthesizes this package’s account app in a child process',
    'tests/cdkNagSynth.integration.test.ts': 'runs the real `cdk` CLI on this package’s app, in a child process',
    'tests/common/everyAppSynthesis.ts': 'synthesizes every CDK app in the repository, each in a child process',
    '__tests__/lambdaRoleReach.test.ts': 'maps this package’s Lambda handlers to their `src/` files on disk',
    'tests/ssmParametersReadable.integration.test.ts': 'synthesizes the global and account apps in a child process',
};

/** Resolve a relative specifier, repo-relative, to a file `read` knows, or `undefined`. Pure. */
function resolveLocal(from: string, specifier: string, read: (file: string) => string | undefined): string | undefined {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    const stem = base.replace(/\.(?:js|mjs|ts|tsx)$/u, '');

    return [base, `${stem}.ts`, `${stem}.tsx`, `${base}.ts`, `${base}/index.ts`].find(
        (candidate) => read(candidate) !== undefined,
    );
}

/** The module specifiers a file imports (static, type-only, dynamic) and its relative string literals. Pure. */
function referencesOf(file: string, text: string): { readonly modules: string[]; readonly paths: string[] } {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const modules: string[] = [];
    const paths: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            modules.push(node.moduleSpecifier.text);

            return;
        }

        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [argument] = node.arguments;

            if (argument !== undefined && ts.isStringLiteralLike(argument)) {
                modules.push(argument.text);

                return;
            }
        }

        if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
        ) {
            modules.push(node.argument.literal.text);
        }

        if (ts.isStringLiteralLike(node) && node.text.startsWith('../')) {
            paths.push(node.text);
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return { modules, paths };
}

/**
 * Whether a file reaches infrastructure code, following its local imports.
 *
 * @param file - Repo-relative path.
 * @param read - The text of a repo-relative file, or `undefined` when there is none.
 * @returns `true` when an import, transitively, or a relative path literal naming an existing file lands on
 *   infrastructure. Pure.
 */
function reachesInfra(file: string, read: (file: string) => string | undefined, seen = new Set<string>()): boolean {
    const text = read(file);

    if (text === undefined || seen.has(file)) {
        return false;
    }

    seen.add(file);

    const { modules, paths } = referencesOf(file, text);
    const landsOnInfra = (specifier: string): boolean =>
        INFRA_CODE.test(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));

    return (
        // A path literal counts only when it names a file that exists: a fixture string such as `'../lib/Stack.js'`
        // describes code, and lands on infra only by the accident of where its test file sits.
        paths.some((literal) => landsOnInfra(literal) && resolveLocal(file, literal, read) !== undefined) ||
        modules.some((specifier) => {
            if (!specifier.startsWith('.')) {
                const name = specifier.startsWith('@')
                    ? specifier.split('/').slice(0, 2).join('/')
                    : specifier.split('/')[0];

                return INFRA_PACKAGES.has(name ?? '');
            }

            if (landsOnInfra(specifier)) {
                return true;
            }

            const target = resolveLocal(file, specifier, read);

            return target !== undefined && reachesInfra(target, read, seen);
        })
    );
}

/**
 * The local modules a file imports, transitively, repo-relative.
 *
 * @param file - Repo-relative path.
 * @param read - The text of a repo-relative file, or `undefined` when there is none.
 * @returns Every local module reached, not including `file`. Pure.
 */
function localImportsOf(file: string, read: (file: string) => string | undefined): ReadonlySet<string> {
    const reached = new Set<string>();
    const pending = [file];

    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
        const text = read(current);

        if (text === undefined) {
            continue;
        }

        for (const specifier of referencesOf(current, text).modules.filter((name) => name.startsWith('.'))) {
            const target = resolveLocal(current, specifier, read);

            if (target !== undefined && target !== file && !reached.has(target)) {
                reached.add(target);
                pending.push(target);
            }
        }
    }

    return reached;
}

/** Tracked TypeScript files under a directory, repo-relative. @sideEffect Runs `git ls-files`. */
function trackedTypeScript(...dirs: string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--', ...dirs], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((file) => /\.tsx?$/u.test(file));
}

/** Read a repo file, or `undefined` when there is none. @sideEffect Reads the file system. */
function readRepoFile(file: string): string | undefined {
    try {
        return readFileSync(path.join(REPO_ROOT, file), 'utf8');
    } catch {
        return undefined;
    }
}

describe('reachesInfra', () => {
    it.each<[string, Record<string, string>, boolean]>([
        ['a CDK import', { 'p/a.test.ts': "import { App } from 'aws-cdk-lib';" }, true],
        ['a scoped infra package', { 'p/a.test.ts': "import { x } from '@radicle-co/infra-shared/security';" }, true],
        ['a CDK app package by name', { 'p/a.test.ts': "import { x } from '@kitchensink/food-service-infra';" }, true],
        ['a type-only CDK import', { 'p/a.test.ts': "import type { Stack } from 'aws-cdk-lib';" }, true],
        ['a dynamic import', { 'p/a.test.ts': "const c = await import('constructs');" }, true],
        [
            'CDK named only inside a string',
            { 'p/a.test.ts': "const fixture = `import { App } from 'aws-cdk-lib';`;" },
            false,
        ],
        [
            'reach only through a local helper',
            { 'p/a.test.ts': "import { h } from './h.js';", 'p/h.ts': "import { App } from 'aws-cdk-lib';" },
            true,
        ],
        [
            'an import cycle with no infra',
            { 'p/a.test.ts': "import { b } from './b.js';", 'p/b.ts': "import { a } from './a.test.js';" },
            false,
        ],
        [
            'an import of infra-global code',
            { 'packages/infra/global/__tests__/a.test.ts': "import { S } from '../lib/platform/S.js';" },
            true,
        ],
        [
            'an import of another package’s infra code',
            { 'packages/tools/x/__tests__/a.test.ts': "import { c } from '../../../services/w/infra/lib/c.js';" },
            true,
        ],
        [
            'a relative file-path literal into infra code',
            {
                'packages/infra/global/__tests__/a.test.ts': "const app = read('../bin/app.ts');",
                'packages/infra/global/bin/app.ts': 'new App();',
            },
            true,
        ],
        [
            'a relative literal into infra code naming no file, as fixture data does',
            { 'packages/infra/global/__tests__/a.test.ts': "const row = { importedFrom: '../lib/Gone.js' };" },
            false,
        ],
        [
            'a repo-relative path named as data',
            { 'packages/tools/x/__tests__/a.test.ts': "const app = 'packages/infra/global/bin/app.ts';" },
            false,
        ],
        ['only vitest and node', { 'p/a.test.ts': "import { it } from 'vitest';\nimport fs from 'node:fs';" }, false],
        ['an import of a module that does not exist', { 'p/a.test.ts': "import './gone.js';" }, false],
    ])('%s', (_case, files, expected) => {
        const [entry] = Object.keys(files);

        expect(reachesInfra(entry ?? '', (file) => files[file])).toBe(expected);
    });
});

describe('every test lives with its subject', () => {
    const guards = trackedTypeScript(GUARDS);
    const infraFiles = trackedTypeScript(`${INFRA}/__tests__`, `${INFRA}/tests`);
    const isTest = (file: string): boolean => /\.test\.tsx?$/u.test(file);
    const isDeployed = (file: string): boolean => file.startsWith(`${INFRA}/tests/deployed/`);
    /** A runtime-reach file reads as an infra import, so a suite that imports it is placed by it. */
    const withRuntimeReach =
        (infraCode: ReadonlySet<string>) =>
        (candidate: string): string | undefined =>
            infraCode.has(candidate) || candidate.slice(INFRA.length + 1) in RUNTIME_REACH
                ? "import 'aws-cdk-lib';"
                : readRepoFile(candidate);

    it('scans both packages (a guard that scans nothing passes for the wrong reason)', () => {
        expect(guards).toContain(`${GUARDS}/__tests__/guardPlacement.test.ts`);
        expect(infraFiles).toContain(`${INFRA}/__tests__/NetworkStack.test.ts`);
        expect(INFRA_PACKAGES).toContain('@radicle-co/infra-shared');
    });

    it('holds nothing here that reaches infrastructure code', () => {
        expect(guards.filter((file) => reachesInfra(file, readRepoFile))).toEqual([]);
    });

    it('holds no test in infra-global that does not reach it', () => {
        const direct = withRuntimeReach(new Set());
        const reaching = infraFiles.filter((file) => isTest(file) && (isDeployed(file) || reachesInfra(file, direct)));
        // The local helpers those suites are built on are infra code too.
        const support = new Set(
            reaching
                .flatMap((file) => [...localImportsOf(file, readRepoFile)])
                .filter((file) => file.startsWith(`${INFRA}/`)),
        );
        const misplaced = infraFiles.filter(
            (file) => isTest(file) && !reaching.includes(file) && !reachesInfra(file, withRuntimeReach(support)),
        );

        expect(misplaced, 'a test with no infrastructure subject belongs in packages/tools/repoGuards').toEqual([]);
    });

    it('holds no helper here that only infra uses', () => {
        // Infra imports a helper here by package name; count those, and this package's own importers.
        const infraUses = new Set(
            infraFiles.flatMap((file) =>
                referencesOf(file, readRepoFile(file) ?? '')
                    .modules.filter((name) => name.startsWith('@kitchensink/repo-guards/'))
                    .map((name) => name.slice('@kitchensink/repo-guards/'.length)),
            ),
        );
        const exportsMap: Readonly<Record<string, string>> =
            (JSON.parse(readRepoFile(`${GUARDS}/package.json`) ?? '{}') as { exports?: Record<string, string> })
                .exports ?? {};
        const importsHere = new Map(guards.map((file) => [file, localImportsOf(file, readRepoFile)]));
        const usedHereBeyondItsTest = (helper: string): boolean =>
            [...importsHere].some(
                ([file, reached]) => file !== helper.replace(/\.ts$/u, '.test.ts') && reached.has(helper),
            );
        const infraOnly = Object.entries(exportsMap)
            .map(([subpath, target]) => [subpath.slice(2), `${GUARDS}/${target.slice(2)}`] as const)
            .filter(([name, helper]) => infraUses.has(name) && !usedHereBeyondItsTest(helper))
            .map(([, helper]) => helper);

        expect(infraOnly, 'a helper only infra uses belongs in packages/infra/global').toEqual([]);
    });

    it('keeps the runtime-reach register exact: every entry exists, and none already reaches by import', () => {
        const stale = Object.keys(RUNTIME_REACH).filter((file) => {
            const repoPath = `${INFRA}/${file}`;

            return readRepoFile(repoPath) === undefined || reachesInfra(repoPath, readRepoFile);
        });

        expect(stale).toEqual([]);
    });
});
