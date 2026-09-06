/**
 * ⛔ EVERY k6 SCRIPT DECLARES WHETHER IT CAN RUN AGAINST A DEPLOYED STAGE, AND THE DECLARATION IS CHECKED.
 *
 * The owner's ruling is that k6 runs when the PR's sandbox is up and skips when it is not. But a third of
 * these scripts CANNOT run against a deployed origin at any pool size, because their assertion IS the
 * runner-local substrate: a service booted trusting a throwaway EdDSA public key, an SQS queue nobody
 * drains so its DEPTH is the evidence, a fixture that writes ~175,000 rows straight to `DATABASE_URL`, a
 * `recipe_versions` row DELIBERATELY absent so the read must fall through to S3. Pointing those at a
 * deployed stage produces a red that is not a regression, or — worse — a green that measured nothing.
 *
 * So the tier is DECLARED once, in the script's own header, beside the notes a reader already opens:
 *
 *     // @loadTier substrate-bound — prepareVersionArchiveFixture.ts prunes the row and PUTs the snapshot
 *
 * ⚠️ WHY A DECLARATION RATHER THAN A DERIVATION, since this repo prefers derived guards. A pure derivation
 * was tried and gives WRONG ANSWERS on four of twenty-one. "Substrate-bound iff it `open()`s a gitignored
 * fixture" mis-files `versionArchiveRead` as capable (it opens nothing — its substrate is database and S3
 * STATE, invisible in the source) and mis-files `authFlood`, `sessionHotPath` and `authRejection` as bound
 * (what they open is a CREDENTIAL, which is replaceable, not a world). The verdict is a judgement with a
 * stated reason, so it is written down — and then corroborated from a direction that cannot be faked.
 *
 * That is the `natEgressConsumers.test.ts` shape: declared once, asserted in both directions.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { allLoadScripts, deployedCapableScripts, substrateBoundScripts, tierOf } from '@kitchensink/loadtest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** Every committed k6 scenario, discovered — never enumerated. */
function committedScripts(): readonly string[] {
    return execFileSync('git', ['ls-files', '*.load.js'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.length > 0);
}

describe('the load-tier partition', () => {
    it('discovers the scripts from git, so a new one cannot arrive unclassified', () => {
        // If this ever disagrees, the module is reading a stale list rather than the repository.
        expect([...allLoadScripts()].sort()).toStrictEqual([...committedScripts()].sort());
        expect(allLoadScripts().length).toBeGreaterThan(0);
    });

    it('⛔ is TOTAL — every script carries exactly one marker', () => {
        const unmarked = allLoadScripts().filter((script) => tierOf(read(script)) === undefined);

        expect(unmarked, `these scripts declare no @loadTier: ${unmarked.join(', ')}`).toStrictEqual([]);
    });

    it('⛔ is DISJOINT and covers the whole corpus', () => {
        const capable = deployedCapableScripts();
        const bound = substrateBoundScripts();

        expect(capable.filter((script) => bound.includes(script))).toStrictEqual([]);
        expect([...capable, ...bound].sort()).toStrictEqual([...allLoadScripts()].sort());
    });

    it('⛔ is NON-VACUOUS in both directions', () => {
        // A partition that put everything on one side would satisfy total + disjoint and mean nothing.
        expect(deployedCapableScripts().length).toBeGreaterThan(0);
        expect(substrateBoundScripts().length).toBeGreaterThan(0);
    });

    it('⛔ every verdict states a REASON — an unexplained classification is a guess', () => {
        const unexplained = allLoadScripts().filter((script) => {
            const verdict = tierOf(read(script));

            return verdict !== undefined && (verdict.reason ?? '').trim().length < 20;
        });

        expect(unexplained, `these state a tier with no reason: ${unexplained.join(', ')}`).toStrictEqual([]);
    });
});
