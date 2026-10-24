/**
 * The tracked TypeScript sources the role-split guards read — DISCOVERED from git, so a new package is covered the
 * day it lands rather than the day someone remembers to add it to a list.
 *
 * Production code only: tests, fixtures and generated output are excluded, because a test that NAMES a role or
 * issues a `DROP DATABASE` against a throwaway server is doing its job.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A test, fixture or generated path — not production code. */
const NOT_PRODUCTION =
    /(^|\/)(__tests__|__fixtures__|tests|dist|dist-lambda|cdk\.out|node_modules)\/|\.test\.ts$|\.d\.ts$/u;

/**
 * IAM policy DATA: the CDK bootstrap package's tables name actions (`sqs:SendMessage`, `rds-db:connect`) to cap or to
 * grant to a role CloudFormation creates. They confer no queue, topic or database authority on any stack, which is
 * what the two guards that exclude them (`queueProducerRegister`, `dbUserGrantRegister`) register, so they judge
 * the stacks that CONSTRUCT grants and not the ceiling those grants must fit under.
 *
 * ⚠️ Narrowly the `src/` of that one package: a stack added there would still be read by every other guard.
 */
export const IAM_POLICY_DATA = /^packages\/infra\/bootstrap\/src\//u;

/**
 * Every production `.ts` file under `packages/` and `shared/` in the WORKING TREE, repo-relative and sorted: tracked
 * or new-but-not-ignored, minus anything deleted — so the guards judge the tree being committed, not the last commit.
 */
export function productionSources(): readonly string[] {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages/*.ts', 'shared/*.ts'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
    )
        .split('\n')
        .filter((path) => path.endsWith('.ts') && !NOT_PRODUCTION.test(path) && existsSync(join(REPO_ROOT, path)))
        .filter((path, index, all) => all.indexOf(path) === index)
        .sort();
}

/**
 * Every file the prototype-pollution sweep reads: production TypeScript, plus the `.tsx` and `.mjs` that
 * `productionSources()` excludes.
 *
 * ⛔ IT LIVES HERE SO TWO READERS SHARE ONE STATEMENT. `prototypePollutionSinks.test.ts` sweeps this set,
 * and `withoutTsComments.test.ts` asserts the blanking lemma that licenses that sweep's raw-text
 * pre-filter. Declared separately they drifted immediately: the lemma covered 1,254 files while the sweep
 * ran over 1,947, leaving the 693 `.tsx`/`.mjs` — exactly the ones the sweep had just been widened to
 * include — outside the assertion that says the sweep is sound.
 *
 * ⚠️ ADDITIVE, and `productionSources()` is deliberately NOT widened: ten other guards read that helper,
 * and "production TypeScript" is not this sweep's meaning to change on their behalf.
 *
 * @returns Sorted repo-relative paths.
 * @sideEffect Shells out to `git ls-files`.
 */
export function sinkScanSources(): readonly string[] {
    const extra = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.tsx', '*.mjs'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
    )
        .split('\n')
        .filter((path) => path !== '' && !/node_modules\//u.test(path) && existsSync(join(REPO_ROOT, path)));

    return [...new Set([...productionSources(), ...extra])].sort();
}

/** A repo-relative file's text. */
export function readSource(path: string): string {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** A test, fixture or generated path in ANY language — not production code. */
const NOT_PRODUCTION_ANY =
    /(^|\/)(__tests__|__fixtures__|tests|test|dist|dist-lambda|cdk\.out|node_modules)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/u;

/** The languages a database statement could be written in here. */
const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]s|sh|sql)$/u;

/**
 * Every production file that could carry a SQL statement — TypeScript, JavaScript, shell and SQL — under `packages/`,
 * `shared/`, `scripts/` and `.github/`, in the working tree.
 */
export function productionScripts(): readonly string[] {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages', 'shared', 'scripts', '.github'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
    )
        .split('\n')
        .filter(
            (path) =>
                SCRIPT_EXTENSIONS.test(path) && !NOT_PRODUCTION_ANY.test(path) && existsSync(join(REPO_ROOT, path)),
        )
        .filter((path, index, all) => all.indexOf(path) === index)
        .sort();
}

/**
 * Every file the SERVICE integration and e2e tiers execute: each service's `vitest.integration.config.ts` and
 * `vitest.e2e.config.ts`, the specs their `include` globs reach, their `globalSetup`s, and — transitively — the
 * modules those import from within the package.
 *
 * ⛔ Discovered, never listed. `productionSources()` deliberately excludes `tests/`, which is right for every
 * other role-split guard and exactly wrong for this one: the role a test connects as IS the thing under guard.
 *
 * ⚠️ Both tiers, because both boot the service against a database. A scan of the integration config alone drew
 * the line THROUGH a shared module: `recipe-service/tests/e2e/harness.ts` was converted (ten integration specs
 * import it) while its fifteen e2e callers kept binding their own pools from `DATABASE_URL` — so the tier gated
 * on one variable and connected on another. `tests/load/**` stays out: those are k6 fixtures that seed a database
 * an OPERATOR names, and sweeping them would make the guard assert something it does not mean.
 */
export function integrationTierSources(): readonly string[] {
    const configs = trackedFiles(
        'packages/services/*/vitest.integration.config.ts',
        'packages/services/*/vitest.e2e.config.ts',
    );

    return [...new Set(configs.flatMap((config) => configReach(config)))].sort();
}

/**
 * What one vitest tier config runs: the config itself, the files its `include` and `globalSetup` globs reach in its
 * package, and the test modules those import, transitively. Discovered from the config's own text, so a new suite
 * or a new tier is covered the day it lands.
 *
 * ⚠️ `tests/load/` is EXCLUDED, for the reason {@link integrationTierSources} gives.
 *
 * @param config - A repo-relative `vitest.*.config.ts`.
 * @returns The repo-relative paths, the config first.
 * @sideEffect Reads the config and lists the package's files through git.
 */
export function configReach(config: string): readonly string[] {
    const directory = config.slice(0, config.lastIndexOf('/'));
    const text = readSource(config);
    const patterns = [
        ...[...text.matchAll(/include:\s*\[([^\]]*)\]/gu)].flatMap((match) => quotedStrings(match[1] ?? '')),
        ...[...text.matchAll(/globalSetup:\s*\[([^\]]*)\]/gu)].flatMap((match) => quotedStrings(match[1] ?? '')),
    ];
    const candidates = trackedFiles(directory).filter(
        (path) => !path.includes('/tests/load/') && !path.includes('/node_modules/'),
    );
    const found = new Set<string>([config]);

    for (const pattern of patterns) {
        for (const path of candidates.filter((candidate) => matchesGlob(pattern, directory, candidate))) {
            addWithImports(path, found);
        }
    }

    return [...found];
}

/**
 * Every tracked tier config with this file name under `packages/`, for example `vitest.integration.config.ts`.
 *
 * @param fileName - The config's file name.
 * @returns Repo-relative paths, sorted.
 * @sideEffect Lists files through git.
 */
export function tierConfigs(fileName: string): readonly string[] {
    return trackedFiles(`:(glob)packages/**/${fileName}`)
        .filter((path) => !path.includes('/node_modules/'))
        .sort();
}

/** Tracked-or-new, not-ignored `.ts` and `.tsx` files under the given pathspecs, minus anything deleted from the tree. */
function trackedFiles(...pathspecs: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((path) => /\.tsx?$/u.test(path) && existsSync(join(REPO_ROOT, path)))
        .filter((path, index, all) => all.indexOf(path) === index);
}

/** The single- or double-quoted strings in a fragment of config source. Pure. */
function quotedStrings(fragment: string): readonly string[] {
    return [...fragment.matchAll(/['"]([^'"]+)['"]/gu)].map((match) => match[1] as string);
}

/**
 * Whether `path` is what `pattern` names, relative to the package `directory`. Supports the two glob forms the
 * configs use: `**` across directories and `*` within one. Pure.
 */
function matchesGlob(pattern: string, directory: string, path: string): boolean {
    const relative = pattern.replace(/^\.\//u, '');
    // Placeholders first: translating `**` into a pattern that itself contains `*` would then be re-translated
    // by the `*` rule, which silently produces an expression matching nothing.
    const expression = `${directory}/${relative}`
        .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
        .replace(/\*\*\//gu, '\uE000')
        .replace(/\*\*/gu, '\uE001')
        .replace(/\*/gu, '[^/]*')
        .replace(/\uE000/gu, '(?:[^/]+/)*')
        .replace(/\uE001/gu, '.*');

    return new RegExp(`^${expression}$`, 'u').test(path);
}

/**
 * Add `path` and every test module it imports, transitively ({@link isTestModule}, {@link relativeSpecifiers}).
 *
 * ⚠️ It stops at production modules: they are `productionSources()`'s subject and have their own guards. A seed
 * module a global setup imports is production code that the tier merely calls.
 */
function addWithImports(path: string, found: Set<string>): void {
    if (found.has(path)) {
        return;
    }

    found.add(path);

    for (const specifier of relativeSpecifiers(path, readSource(path))) {
        const resolved = resolveRelative(path, specifier, (candidate) => existsSync(join(REPO_ROOT, candidate)));

        if (resolved !== undefined && isTestModule(resolved) && !resolved.includes('/tests/load/')) {
            addWithImports(resolved, found);
        }
    }
}

/** A directory whose modules are test code: a suite, or a helper or stand-in a suite imports. */
const TEST_MODULE = /(^|\/)(tests|__tests__|__integration__|support)\//u;

/**
 * Whether a repo-relative module is test code a tier runs, as opposed to the production code it calls. Pure.
 *
 * @param path - A repo-relative path.
 * @returns `true` under `tests/`, `__tests__/`, `__integration__/` or `support/`.
 */
export function isTestModule(path: string): boolean {
    return TEST_MODULE.test(path);
}

/**
 * Every relative module a source loads: a static import, a side-effect import, a re-export, and a dynamic `import()`
 * with a literal specifier. Read with the TypeScript parser, so a specifier in a comment or a string is not one. Pure.
 *
 * @param path - The source's path, whose extension decides whether it is parsed as TSX.
 * @param text - The source.
 * @returns The specifiers, as written.
 */
export function relativeSpecifiers(path: string, text: string): readonly string[] {
    const file = parseSource(path, text);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        const specifier =
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined
                ? node.moduleSpecifier
                : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
                  ? node.arguments[0]
                  : undefined;

        if (specifier !== undefined && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
            found.push(specifier.text);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

/**
 * A source file parsed by its own extension: TSX only for `.tsx`, because a `.ts` file read as TSX takes a type
 * assertion or a generic arrow for a JSX element and loses the rest of the file. Pure.
 *
 * @param path - The file's path.
 * @param text - Its source.
 * @returns The parsed file.
 */
export function parseSource(path: string, text: string): ts.SourceFile {
    return ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

/**
 * The repo-relative `.ts` or `.tsx` module a relative specifier names from `from`, when one exists. Pure over `exists`.
 *
 * @param from - The importing file, repo-relative.
 * @param specifier - A relative specifier, with a `.js` extension or none.
 * @param exists - Whether a repo-relative path exists.
 * @returns The module, or `undefined`.
 */
export function resolveRelative(
    from: string,
    specifier: string,
    exists: (path: string) => boolean,
): string | undefined {
    const resolved: string[] = [];

    for (const part of `${from.slice(0, from.lastIndexOf('/'))}/${specifier.replace(/\.js$/u, '')}`.split('/')) {
        if (part === '..') {
            resolved.pop();
        } else if (part !== '.') {
            resolved.push(part);
        }
    }

    const base = resolved.join('/');

    return [`${base}.ts`, `${base}.tsx`].find(exists);
}
