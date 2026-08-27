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
});
