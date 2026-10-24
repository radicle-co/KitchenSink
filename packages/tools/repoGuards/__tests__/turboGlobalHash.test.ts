// @vitest-environment node
/**
 * Every root-level config that changes what a turbo task MEANS must be inside turbo's global hash.
 *
 * ## The defect this was written for
 *
 * Turbo's cache is an assertion: a cache hit says "these exact inputs already passed", and the task does not
 * execute. That assertion is only sound if the hash covers every input. Measured on 2026-09-07, it did not:
 *
 *     npx turbo run typecheck --dry=json  →  globalCacheInputs.files = { ".gitattributes": … }
 *
 * One file, plus the lockfile. Root `tsconfig.json` — which sets `include`, `exclude` and the base config
 * every package's typecheck extends — was invisible to it, as were `prettier.config.js` (which decides what
 * `format:check` considers correct) and `.nvmrc` (which decides which compiler runs at all). Edit any of
 * them and turbo would report typecheck CACHED-PASS without re-running a single package against the new
 * config.
 *
 * It has never bitten because CI shares no cache: `.turbo/cache` is restored in exactly one job, so every
 * other job recomputes from cold and nothing is ever wrongly reused. That is not a safeguard, it is the
 * absence of the feature. The moment the cache is shared across jobs — which is worth roughly three minutes
 * a run — a stale hit becomes a green check for work that never happened, and a check that reports pass
 * without running is worse than no check, because it is indistinguishable from one that did.
 *
 * ## Why it asks turbo, and not `turbo.json`
 *
 * Following {@link file://./turboBuildGraph.test.ts}: the question is what turbo actually hashes, not what a
 * config key claims. `globalDependencies` is the usual way to get a file in there, but it is not the only
 * one, and asserting the key would pass for a config that turbo ignores — exactly the class of "the setting
 * is present and inert" defect this repo keeps finding. The resolved graph cannot lie about it.
 *
 * The shared configs are deliberately NOT listed here: `@kitchensink/typescript`, `@kitchensink/eslint`,
 * `@kitchensink/prettier` and `@kitchensink/vitest` are real workspace packages, so turbo already hashes
 * them through the dependency edges that reach them. Only files at the repo ROOT — which belong to no
 * package and so sit outside every edge — need declaring.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link configsMissingFromGlobalHash} is a
 * verdict over plain data, fired at a deliberately-incomplete fake as well as at turbo's real answer.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * Root-level filenames that change the meaning of a turbo-run task.
 *
 * ⛔ Matched as EXACT names, never as a `tsconfig*` prefix: `tsconfig.tsbuildinfo` is build output that
 * changes on every compile, and requiring it in the global hash would invalidate every package's cache on
 * every run — turning the gate into a permanent cache miss dressed up as correctness.
 *
 * `turbo.json` is absent on purpose: turbo hashes its own configuration, so declaring it would assert
 * something turbo already guarantees.
 */
const ROOT_CONFIG_FILES: readonly string[] = ['.npmrc', '.nvmrc', 'prettier.config.js', 'tsconfig.json'];

/**
 * The root-level configs turbo does not hash.
 *
 * @param present - Root config filenames that exist in the working tree.
 * @param hashed - Filenames turbo reports in `globalCacheInputs.files`.
 * @returns One explanatory line per unhashed config, empty when every one is covered.
 */
export function configsMissingFromGlobalHash(present: readonly string[], hashed: readonly string[]): readonly string[] {
    const covered = new Set(hashed);

    return present
        .filter((file) => !covered.has(file))
        .map(
            (file) =>
                `${file}: edits it, and turbo still reports a cache hit — add it to globalDependencies in turbo.json`,
        );
}

/**
 * The root config files that actually exist.
 *
 * @returns Their filenames, in declaration order.
 * @sideEffect Reads the working tree.
 */
function presentRootConfigs(): readonly string[] {
    const entries = new Set(readdirSync(REPO_ROOT));

    return ROOT_CONFIG_FILES.filter((file) => entries.has(file));
}

/**
 * The files turbo reports inside its global hash.
 *
 * @returns Filenames from `globalCacheInputs.files`.
 * @sideEffect Runs the turbo CLI against the working tree.
 */
function globallyHashedFiles(): readonly string[] {
    const stdout = execFileSync('npx', ['turbo', 'run', 'typecheck', '--dry=json'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const plan = JSON.parse(stdout) as { globalCacheInputs?: { files?: Record<string, string> } };

    return Object.keys(plan.globalCacheInputs?.files ?? {});
}

describe('configsMissingFromGlobalHash', () => {
    it('names a root config turbo does not hash', () => {
        expect(configsMissingFromGlobalHash(['tsconfig.json'], ['.gitattributes'])).toEqual([
            expect.stringContaining('tsconfig.json'),
        ]);
    });

    it('is quiet when every present config is hashed', () => {
        expect(configsMissingFromGlobalHash(['tsconfig.json'], ['.gitattributes', 'tsconfig.json'])).toEqual([]);
    });

    it('judges only what is present — an absent config is not a finding', () => {
        expect(configsMissingFromGlobalHash([], ['.gitattributes'])).toEqual([]);
    });
});

describe("turbo's global hash covers the root configs", () => {
    it('is not vacuous: the working tree really does carry root configs to check', () => {
        expect(presentRootConfigs().length).toBeGreaterThan(0);
    });

    it('hashes every root-level config that changes what a task means', () => {
        expect(configsMissingFromGlobalHash(presentRootConfigs(), globallyHashedFiles())).toEqual([]);
    });
});
