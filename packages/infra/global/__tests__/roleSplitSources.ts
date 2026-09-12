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

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A test, fixture or generated path — not production code. */
const NOT_PRODUCTION =
    /(^|\/)(__tests__|__fixtures__|tests|dist|dist-lambda|cdk\.out|node_modules)\/|\.test\.ts$|\.d\.ts$/u;

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

/** A repo-relative file's text. */
export function readSource(path: string): string {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** The text with `//` and `/* … *\/` comments blanked — prose is not code. Line structure is kept. */
export function withoutTsComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '))
        .replace(/(^|[^:'"`])\/\/.*$/gmu, (_match, lead: string) => lead);
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

/** The text with the comments of its language blanked: `#` for shell, `--` for SQL, `//` and `/* *\/` otherwise. */
export function withoutComments(path: string, text: string): string {
    if (path.endsWith('.sh')) {
        return text.replace(/^\s*#.*$/gmu, '');
    }

    if (path.endsWith('.sql')) {
        return text.replace(/--.*$/gmu, '');
    }

    return withoutTsComments(text);
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
    const found = new Set<string>();

    for (const config of configs) {
        const directory = config.slice(0, config.lastIndexOf('/'));
        const text = readSource(config);
        const patterns = [
            ...[...text.matchAll(/include:\s*\[([^\]]*)\]/gu)].flatMap((match) => quotedStrings(match[1] ?? '')),
            ...[...text.matchAll(/globalSetup:\s*\[([^\]]*)\]/gu)].flatMap((match) => quotedStrings(match[1] ?? '')),
        ];
        // ⚠️ `tests/load/` is EXCLUDED — see the module docstring.
        const candidates = trackedFiles(`${directory}/tests`, `${directory}/__tests__`).filter(
            (path) => !path.includes('/tests/load/'),
        );

        found.add(config);

        for (const pattern of patterns) {
            for (const path of candidates.filter((candidate) => matchesGlob(pattern, directory, candidate))) {
                addWithImports(path, found);
            }
        }
    }

    return [...found].sort();
}

/** Tracked-or-new, not-ignored `.ts` files under the given pathspecs, minus anything deleted from the tree. */
function trackedFiles(...pathspecs: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((path) => path.endsWith('.ts') && existsSync(join(REPO_ROOT, path)))
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
 * Add `path` and every module it imports from a TEST directory, transitively.
 *
 * ⚠️ It stops at `src/`: production modules are `productionSources()`'s subject and have their own guards. A
 * seed module a global setup imports is production code that the tier merely calls.
 */
function addWithImports(path: string, found: Set<string>): void {
    if (found.has(path)) {
        return;
    }

    found.add(path);

    const directory = path.slice(0, path.lastIndexOf('/'));

    for (const match of readSource(path).matchAll(/from\s+['"](\.[^'"]+)['"]/gu)) {
        const specifier = (match[1] as string).replace(/\.js$/u, '.ts');
        const resolved = join(directory, specifier).replace(/\\/gu, '/');

        const inTestTier = /(^|\/)(tests|__tests__)\//u.test(resolved) && !resolved.includes('/tests/load/');

        if (inTestTier && existsSync(join(REPO_ROOT, resolved))) {
            addWithImports(resolved, found);
        }
    }
}
