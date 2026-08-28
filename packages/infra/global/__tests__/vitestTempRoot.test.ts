/**
 * Every vitest config confines its temp directories — asserted by DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. On 2026-08-27 the machine's disk hit 100% with **110 GB in `/tmp` across 95,827
 * directories**. Two producers, neither cleaning up: `aws-cdk-lib` synthesising into `mkdtemp(cdk.out*)`
 * whenever a test builds `new App()` with no `outdir` (64,544 of them), and our own
 * `mkdtempSync(path.join(tmpdir(), …))` fixtures, several of which have no teardown at all (31,283 more).
 *
 * ⛔ IT ENUMERATES NOTHING. The config list comes from the FILESYSTEM, so a config added tomorrow is covered
 * the day it lands. A hand-written list of the 26 configs that leaked would have been a copy of a list, and
 * `natEgressConsumers.test.ts` records what happens to those: _"a copy of a list cannot detect that the list
 * is incomplete."_ That is the whole failure mode here — one forgotten config leaks forever and silently.
 *
 * ⚠️ A config that merges `baseConfig` inherits the hook and needs no line of its own, so BOTH routes count.
 * Asserting the literal string would fail the two configs that are already correct by inheritance.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Every vitest config in the workspace, found rather than listed. */
const configs = (): readonly string[] =>
    globSync('packages/**/vitest*.config.ts', { cwd: REPO_ROOT, ignore: '**/node_modules/**' }).sort();

describe('vitest temp-root confinement', () => {
    it('finds the configs by discovery, and there are enough of them to be a real check', () => {
        // ⛔ Anti-vacuity. A glob that matched nothing would make every assertion below pass silently — the
        // exact shape of guard this repo treats as coverage theatre.
        expect(configs().length).toBeGreaterThan(20);
    });

    it('confines temp directories in EVERY config, by its own hook or by inheriting baseConfig', () => {
        const leaking = configs().filter((config) => {
            const source = readFileSync(path.join(REPO_ROOT, config), 'utf8');

            return !source.includes('testTempRootSetup') && !source.includes('baseConfig');
        });

        expect(
            leaking,
            `these vitest configs would leak temp directories into the OS temp dir:\n${leaking.join('\n')}`,
        ).toEqual([]);
    });

    /**
     * ⛔ ADDED AFTER THIS GUARD MISSED A REAL BUG. The first wiring pass inserted `globalSetup` into three
     * configs that ALREADY had one, producing a duplicate object key — which is not two hooks but one
     * silently overwriting the other, and the loser would have been each suite's own database provisioning.
     * The presence check above passed happily; `oxlint`'s `no-dupe-keys` in the pre-commit hook is what
     * caught it. A guard that can be satisfied by a broken file is not doing its job.
     */
    it('declares globalSetup at most ONCE per config — a duplicate key is a silent overwrite', () => {
        const duplicated = configs().filter((config) => {
            const declarations = readFileSync(path.join(REPO_ROOT, config), 'utf8')
                .split('\n')
                .filter((line) => /^\s*globalSetup:/u.test(line));

            return declarations.length > 1;
        });

        expect(duplicated, `these configs declare globalSetup more than once:\n${duplicated.join('\n')}`).toEqual([]);
    });

    it('resolves the hook to a real file — a bare specifier fails only at RUN time', () => {
        // `globalSetup` entries are FILE PATHS to vitest, not module specifiers. The first attempt at this
        // wiring used `'@kitchensink/vitest/testTempRoot.js'` and every suite died with `ERR_LOAD_URL`
        // against a path that had the package name spliced into the consumer's own directory.
        const hook = path.join(REPO_ROOT, 'packages/tools/vitest/testTempRoot.js');

        expect(() => readFileSync(hook, 'utf8')).not.toThrow();
        expect(readFileSync(hook, 'utf8')).toContain('TMPDIR');
    });

    /**
     * ⛔ ADDED AFTER THE TEMP ROOT BROKE `format:check`. Confining temp files into `.tmp-test/` fixed the
     * disk leak but moved the artefacts INSIDE the workspace, where each package's `format:check` runs
     * `prettier --check .` and walks them. A CDK-synthesising suite leaves a `cdk.out<rand>` directory under `.tmp-test/run-<rand>`
     * full of generated JSON and the run goes red on files nobody authored.
     *
     * The existing `cdk.out` ignore entry does NOT cover it: `mkdtemp` appends random characters, so the
     * directory is `cdk.out3cvLNA` and a literal pattern misses. The ignore must name `.tmp-test` itself.
     *
     * ⛔ IT ENUMERATES NOTHING. The obligation is DERIVED — a package that runs vitest gets the temp root,
     * so a package with a vitest config AND a `format:check` script must ignore it. Both sides are globbed,
     * so a package added tomorrow is covered the day it lands.
     */
    it('ignores the temp root wherever a vitest package also format-checks itself', () => {
        const owed = globSync('packages/**/package.json', {
            cwd: REPO_ROOT,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
        })
            .filter((manifest) => {
                const parsed: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, manifest), 'utf8'));
                const scripts = (parsed as { scripts?: Record<string, string> }).scripts ?? {};

                if (scripts['format:check'] === undefined) {
                    return false;
                }

                const dir = path.dirname(manifest);

                return globSync('vitest*.config.ts', { cwd: path.join(REPO_ROOT, dir) }).length > 0;
            })
            .map((manifest) => path.dirname(manifest));

        // Anti-vacuity: a filter that matched nothing would satisfy the assertion below in silence.
        expect(owed.length).toBeGreaterThan(10);

        const unignored = owed.filter((dir) => {
            const ignoreFile = path.join(REPO_ROOT, dir, '.prettierignore');

            try {
                return !readFileSync(ignoreFile, 'utf8').includes('.tmp-test');
            } catch {
                return true;
            }
        });

        expect(
            unignored,
            `these packages run vitest and format-check themselves, but do not ignore the temp root:\n${unignored.join('\n')}`,
        ).toEqual([]);
    });
});
