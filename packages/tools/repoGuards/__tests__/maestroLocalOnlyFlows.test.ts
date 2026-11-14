/**
 * SOME FLOWS NEED THE LOCAL STACK; THE DEPLOYED RUN LEAVES THEM OUT AND SAYS SO, AND THE LOCAL RUN KEEPS THEM.
 *
 * The mirror of `maestroSandboxOnlyFlows.test.ts`, in the other direction. `recipes/needsReviewJump` opens a recipe whose line
 * reads NEEDS_REVIEW, which exists only once a verification verdict is stored, and the Bedrock worker that stores it runs in a
 * deployed stage and nowhere else. So its reset (`e2e-seed reset --mode needsReview`) INSERTs the row into the LOCAL recipe
 * database, and refuses any database, recipe API or food API host that is not loopback.
 *
 * ⛔ That refusal is the reason this table exists. A reset that fails STOPS THE WHOLE SHARD (`maestro_run_flow_list`), so a
 * deployed selection that packed the flow would turn the first deployed run into a red job that also never ran every flow
 * behind it. The drop must therefore happen BEFORE packing, on every platform and shard, and it must be printed: a deployed
 * run that quietly lost a flow is a green run over a check nobody ran.
 *
 * Asserted by EXECUTING the script's pure subcommands, as `maestroPlatformExclusions.test.ts` does.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

const LOCAL_ONLY = ['recipes/needsReviewJump'] as const;

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

describe('the flows that need the local stack', () => {
    it('are exactly these, and each is a planned flow', () => {
        const rows = run({}, 'local-only').stdout.split('\n').filter(Boolean);

        expect(rows.map((row) => row.split('|')[0])).toEqual([...LOCAL_ONLY]);

        for (const flow of LOCAL_ONLY) {
            expect(PLANNED, `${flow} is not in the plan`).toContain(flow);
        }
    });

    it('give a reason a reader can act on, naming what only the local stack has', () => {
        for (const row of run({}, 'local-only').stdout.split('\n').filter(Boolean)) {
            expect(row.split('|')[1] ?? '', row).toMatch(/LOCAL recipe database/u);
            expect(row.split('|')[1] ?? '', row).toMatch(/loopback/u);
        }
    });

    /**
     * ⛔ The invariant behind the table, read from the script's own text: every flow whose reset mode is the local-only one is in
     * the table, so a flow cannot be given that reset and then run against a deployed stage that refuses it.
     */
    it('holds EVERY flow whose reset is `needsReview`', () => {
        const declared = /^NEEDS_REVIEW_FLOWS="([^"]*)"/mu.exec(readFileSync(SCRIPT, 'utf8'))?.[1] ?? '';
        const flows = declared.split(/\s+/u).filter(Boolean);

        expect(flows.length).toBeGreaterThan(0);
        expect([...flows].sort()).toEqual([...LOCAL_ONLY].sort());
    });
});

describe('deployed-flows', () => {
    it('drops them, in order, and reports each as local-only with its reason', () => {
        const out = run({}, 'deployed-flows', ...PLANNED);

        expect(out.status).toBe(0);
        expect(lines(out.stdout, 'flow')).toEqual(
            PLANNED.filter((flow) => !(LOCAL_ONLY as readonly string[]).includes(flow)),
        );
        expect(lines(out.stdout, 'local-only').map((row) => row.split('|')[0])).toEqual([...LOCAL_ONLY]);
    });

    it('⛔ refuses to answer a run over no flows, rather than report a green one', () => {
        expect(run({}, 'deployed-flows', ...LOCAL_ONLY).status).toBe(2);
        expect(run({}, 'deployed-flows').status).toBe(2);
    });
});

describe('⛔ the DEPLOYED selection never packs them, on any platform or shard, and says so', () => {
    it.each([
        ['android', 1, 1],
        ['android', 1, 2],
        ['android', 2, 2],
        ['ios', 1, 1],
        ['ios', 1, 3],
        ['ios', 3, 3],
    ] as const)('%s shard %i of %i', (platform, index, count) => {
        const out = run({ MAESTRO_PLATFORM: platform }, 'shard-selection', String(index), String(count));

        expect(out.status, out.stderr).toBe(0);

        for (const flow of LOCAL_ONLY) {
            expect(lines(out.stdout, 'flow'), `${flow} is packed into a deployed ${platform} shard`).not.toContain(
                flow,
            );
            expect(lines(out.stdout, 'deferred'), `${flow} is deferred to another deployed shard`).not.toContain(flow);
            expect(lines(out.stdout, 'local-only').map((row) => row.split('|')[0])).toContain(flow);
        }
    });

    it('still selects every other flow the platform runs, so the drop is one flow and no more', () => {
        const out = run({ MAESTRO_PLATFORM: 'android' }, 'shard-selection', '1', '1');

        expect(lines(out.stdout, 'flow')).toEqual(
            PLANNED.filter((flow) => !(LOCAL_ONLY as readonly string[]).includes(flow)),
        );
    });

    it('sizes the deployed matrix without them — a selector naming only one of them never boots a shard for it', () => {
        const matrix = run({}, 'shard-matrix', '4', 'flow:recipes/needsReviewJump=true');

        expect(matrix.status, matrix.stderr).toBe(0);
        expect(JSON.parse(matrix.stdout)).toEqual([1]);
    });

    it('a selector naming the flow alone still runs the spine and prints the drop, rather than running nothing', () => {
        const out = run(
            { MAESTRO_PLATFORM: 'android' },
            'shard-selection',
            '1',
            '1',
            'flow:recipes/needsReviewJump=true',
        );

        expect(out.status, out.stderr).toBe(0);
        expect(lines(out.stdout, 'flow')).toEqual(['auth/loginFlow']);
        expect(lines(out.stdout, 'local-only').map((row) => row.split('|')[0])).toEqual([...LOCAL_ONLY]);
    });
});

describe('the LOCAL selection (MAESTRO_LOCAL=1) keeps them', () => {
    it.each(['android', 'ios'])(
        '%s runs each exactly once across two shards, and prints no local-only drop',
        (platform) => {
            const env = { MAESTRO_PLATFORM: platform, MAESTRO_LOCAL: '1' };
            const first = run(env, 'shard-selection', '1', '2');
            const second = run(env, 'shard-selection', '2', '2');

            for (const flow of LOCAL_ONLY) {
                const holders = [first, second].filter((shard) => lines(shard.stdout, 'flow').includes(flow));

                expect(holders, `${flow} must run on exactly one local ${platform} shard`).toHaveLength(1);
            }

            expect(lines(first.stdout, 'local-only')).toEqual([]);
            expect(lines(second.stdout, 'local-only')).toEqual([]);
        },
    );
});
