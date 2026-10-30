/**
 * FOUR FLOWS NEED THE DEPLOYED SANDBOX; THE LOCAL SUITE SAYS SO AND THE DEPLOYED RUN STILL RUNS THEM.
 *
 * `recipes/pasteList`, `recipes/pasteListSettle`, `recipes/ingredientCandidates` and `recipes/ambiguityReview` depend on
 * the shared sandbox's food catalog and on the ingredient-verification worker, neither of which `npm run local:up` can
 * stand up. Run locally they cannot pass, and a skip is never a pass (owner rulings 2026-09-05, 2026-10-03; the e2e rule
 * that nothing fakes a remote source). So the LOCAL selection (`local-flows`) leaves them out and PRINTS that it did, as
 * "needs sandbox" lines the local summary repeats; it is the deployed selection (`shard-selection`) that keeps running them.
 *
 * ⛔ The second half is the one that matters: a flow quietly dropped from the DEPLOYED plan is a green run over a
 * check nobody ran. This guard holds the table to the flows that exist, to exactly these four, and asserts the deployed
 * composition still selects every one on both platforms.
 *
 * Asserted by EXECUTING the script's pure subcommands, as `maestroPlatformExclusions.test.ts` does.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

const SANDBOX_ONLY = [
    'recipes/pasteList',
    'recipes/pasteListSettle',
    'recipes/ingredientCandidates',
    'recipes/ambiguityReview',
] as const;

/**
 * Run the script with optional environment overrides.
 *
 * @sideEffect Spawns `bash`. Touches no device and no network.
 */
function run(env: Readonly<Record<string, string>>, ...args: readonly string[]) {
    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', ...env },
    });

    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const lines = (stdout: string, key: string): readonly string[] =>
    stdout.split('\n').flatMap((line) => (line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : []));

const PLANNED = run({}, 'plan')
    .stdout.split('\n')
    .filter(Boolean)
    .map((entry) => entry.slice(entry.indexOf(':') + 1));

describe('the flows that need the deployed sandbox', () => {
    it('are exactly the four the local stack cannot serve, and each is a planned flow', () => {
        const rows = run({}, 'sandbox-only').stdout.split('\n').filter(Boolean);

        expect(rows.map((row) => row.split('|')[0])).toEqual([...SANDBOX_ONLY]);

        for (const flow of SANDBOX_ONLY) {
            expect(PLANNED, `${flow} is not in the plan`).toContain(flow);
        }
    });

    it('give a reason a reader can act on, naming what is missing locally', () => {
        for (const row of run({}, 'sandbox-only').stdout.split('\n').filter(Boolean)) {
            expect(row.split('|')[1] ?? '', row).toMatch(/catalog|verification/u);
        }
    });
});

describe('local-flows', () => {
    it('keeps every other flow, in order, and reports the four as needing the sandbox', () => {
        const out = run({}, 'local-flows', ...PLANNED);

        expect(out.status).toBe(0);
        expect(lines(out.stdout, 'flow')).toEqual(
            PLANNED.filter((flow) => !(SANDBOX_ONLY as readonly string[]).includes(flow)),
        );
        expect(lines(out.stdout, 'needs-sandbox').map((row) => row.split('|')[0])).toEqual([...SANDBOX_ONLY]);
    });

    it('⛔ refuses to answer a run over no flows, rather than report a green one', () => {
        expect(run({}, 'local-flows', ...SANDBOX_ONLY).status).toBe(2);
        expect(run({}, 'local-flows').status).toBe(2);
    });

    it('prints the "not run locally: needs sandbox" line the local summary shows, once per flow', () => {
        const out = run({}, 'local-summary', ...SANDBOX_ONLY);

        for (const flow of SANDBOX_ONLY) {
            expect(out.stdout).toContain(`not run locally: needs sandbox - ${flow}`);
        }
    });
});

describe('⛔ the DEPLOYED selection still runs all four, on both platforms', () => {
    it.each(['android', 'ios'])('%s, on one shard, selects every one of them', (platform) => {
        const out = run({ MAESTRO_PLATFORM: platform }, 'shard-selection', '1', '1');

        expect(out.status, out.stderr).toBe(0);

        for (const flow of SANDBOX_ONLY) {
            expect(lines(out.stdout, 'flow'), `${flow} is no longer in the ${platform} deployed selection`).toContain(
                flow,
            );
        }
    });

    it('does not mark any of them excluded for a platform or skipped by the selector', () => {
        for (const platform of ['android', 'ios']) {
            const out = run({ MAESTRO_PLATFORM: platform }, 'shard-selection', '1', '1');

            for (const flow of SANDBOX_ONLY) {
                expect(lines(out.stdout, 'excluded')).not.toContain(flow);
                expect(lines(out.stdout, 'skipped')).not.toContain(flow);
            }
        }
    });
});
