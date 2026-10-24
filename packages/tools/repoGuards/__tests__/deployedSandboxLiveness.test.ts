// @vitest-environment node
/**
 * The ONE verdict rule for "is the deployed sandbox still up" - `.github/scripts/deployedSandboxLiveness.sh check`.
 *
 * The rule is the one the resolver and both Maestro start probes have always applied: the sandbox is live only
 * when BOTH services answer `live=true` AND neither wants a deploy (`deploy=false`). `live=true, deploy=true`
 * means the gate is about to CREATE or REPLACE the environment, which a test tier must not drive.
 *
 * The real script runs under real bash. Only the gate it asks (`deployGate.sh evaluate`) is replaced, through
 * `DEPLOY_GATE_SCRIPT`, by a stub answering per service from a fixture table, so every live x deploy combination
 * for both services is exercised: 16 rows, one live. Mutation lens: dropping the `deploy=false` term reds the
 * `live=true, deploy=true` rows; checking only one service reds the rows where just the other is down.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/deployedSandboxLiveness.sh', import.meta.url));

let dir: string;
let gate: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'liveness-'));
    gate = join(dir, 'gate.sh');
    // `evaluate <intent> <service> …`: answer from RECIPE_ANSWER / FOOD_ANSWER, shaped `<live>,<deploy>`.
    writeFileSync(
        gate,
        `#!/usr/bin/env bash
service="$3"
if [ "$service" = recipe ]; then answer="$RECIPE_ANSWER"; else answer="$FOOD_ANSWER"; fi
echo "live=\${answer%,*}"; echo "deploy=\${answer#*,}"; echo "reason=\${service} said \${answer}"
`,
        'utf8',
    );
    chmodSync(gate, 0o755);
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

function check(recipe: string, food: string): { status: number; out: string; live: string } {
    const result = spawnSync('bash', [SCRIPT, 'check', 'pr-91', 'us-east-1', 'https://r.test', 'https://f.test'], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', DEPLOY_GATE_SCRIPT: gate, RECIPE_ANSWER: recipe, FOOD_ANSWER: food },
    });
    const out = `${result.stdout}${result.stderr}`;
    const live = (result.stdout.match(/^live=(.*)$/gmu) ?? []).at(-1)?.slice('live='.length) ?? '(none)';

    return { status: result.status ?? -1, out, live };
}

const COMBOS = ['true,false', 'true,true', 'false,false', 'false,true'] as const;
const table = COMBOS.flatMap((recipe) => COMBOS.map((food) => [recipe, food] as const));

describe('deployedSandboxLiveness.sh check', () => {
    it.each(table)('recipe %s / food %s', (recipe, food) => {
        const outcome = check(recipe, food);
        const expected = recipe === 'true,false' && food === 'true,false' ? 'true' : 'false';

        expect(outcome.status, outcome.out).toBe(0);
        expect(outcome.live, outcome.out).toBe(expected);
        expect(outcome.out).toMatch(/^reason=.*recipe:.*food:/mu);
    });

    it('refuses a call without the four arguments rather than guessing a stage', () => {
        const result = spawnSync('bash', [SCRIPT, 'check', 'pr-91'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });
});

/**
 * `stopped` is the MID-SHARD question, and it is a different question from `check`. `check` asks "is it serving?"
 * (health, stack status, seed), which is right for deciding whether to START a shard. Asked after a flow FAILED, that
 * same answer turns a crashed task, a 503 or a redeploy into a skip, because the flow itself may have caused it. Owner
 * rule: a skip only because the sandbox is DOWN. So `stopped` reads the STOP'S OWN facts and never health:
 * the shared tier stopped (the status check's exit 3), or this stage's service stacks deleted by the reclaim. It must
 * hold on two probes a short interval apart; anything unreadable is NOT stopped.
 */
describe('deployedSandboxLiveness.sh stopped', () => {
    let work: string;
    let wake: string;
    let fakeAws: string;

    const STACKS = ['kitchensink-recipe-service-pr-91', 'kitchensink-food-service-pr-91'] as const;

    beforeAll(() => {
        work = mkdtempSync(join(tmpdir(), 'stopped-'));
        wake = join(work, 'wake.sh');
        // The status check: pops one exit code per call from WAKE_RCS (the last one repeats).
        writeFileSync(
            wake,
            `#!/usr/bin/env bash
rc=$(head -n 1 "$WAKE_RCS"); [ "$(wc -l < "$WAKE_RCS")" -gt 1 ] && sed -i '1d' "$WAKE_RCS"
exit "$rc"
`,
            'utf8',
        );
        chmodSync(wake, 0o755);
        mkdirSync(join(work, 'bin'));
        fakeAws = join(work, 'bin', 'aws');
        // `aws cloudformation describe-stacks --stack-name <name> …`: status from STATUS_<index>, ABSENT or THROTTLED.
        writeFileSync(
            fakeAws,
            `#!/usr/bin/env bash
echo "$*" >> "$AWS_LOG"
case "$4" in
    kitchensink-recipe-service-*) answer="$RECIPE_STACK" ;;
    kitchensink-food-service-*) answer="$FOOD_STACK" ;;
esac
case "$answer" in
    ABSENT) echo "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id $4 does not exist" >&2; exit 254 ;;
    THROTTLED) echo 'An error occurred (Throttling) when calling the DescribeStacks operation: Rate exceeded' >&2; exit 254 ;;
    *) echo "$answer" ;;
esac
`,
            'utf8',
        );
        chmodSync(fakeAws, 0o755);
        writeFileSync(
            join(work, 'gate.sh'),
            '#!/usr/bin/env bash\necho "health was consulted" >> "$AWS_LOG"; exit 9\n',
            'utf8',
        );
        chmodSync(join(work, 'gate.sh'), 0o755);
    });

    afterAll(() => {
        rmSync(work, { recursive: true, force: true });
    });

    interface World {
        /** Exit codes of successive status-check calls: 0 up, 3 down, 1 error. */
        readonly wake: readonly number[];
        readonly recipe: string;
        readonly food: string;
    }

    function stopped(world: World): { status: number; out: string; stopped: string; log: string } {
        const rcs = join(work, 'wake.rcs');
        const log = join(work, 'aws.log');

        writeFileSync(rcs, `${world.wake.join('\n')}\n`, 'utf8');
        writeFileSync(log, '', 'utf8');

        const result = spawnSync('bash', [SCRIPT, 'stopped', 'pr-91', 'us-east-1'], {
            encoding: 'utf8',
            env: {
                PATH: `${join(work, 'bin')}:${process.env['PATH'] ?? ''}`,
                SANDBOX_WAKE_SCRIPT: wake,
                DEPLOY_GATE_SCRIPT: join(work, 'gate.sh'),
                STOPPED_CONFIRM_INTERVAL_SECONDS: '0',
                WAKE_RCS: rcs,
                AWS_LOG: log,
                RECIPE_STACK: world.recipe,
                FOOD_STACK: world.food,
            },
        });
        const out = `${result.stdout}${result.stderr}`;
        const verdict = (result.stdout.match(/^stopped=(.*)$/gmu) ?? []).at(-1)?.slice('stopped='.length) ?? '(none)';

        return { status: result.status ?? -1, out, stopped: verdict, log: readFileSync(log, 'utf8') };
    }

    const UP = 'UPDATE_COMPLETE';
    const rows: readonly (readonly [string, World, string])[] = [
        // STOPPED: the stop's own facts.
        ['shared tier stopped, stacks still present', { wake: [3, 3], recipe: UP, food: UP }, 'true'],
        [
            'tier up but this stage reclaimed (both stacks absent)',
            { wake: [0, 0], recipe: 'ABSENT', food: 'ABSENT' },
            'true',
        ],
        [
            'tier up but both stacks being deleted',
            { wake: [0, 0], recipe: 'DELETE_IN_PROGRESS', food: 'DELETE_COMPLETE' },
            'true',
        ],
        // RED: a service that is up but unhealthy, or any state the flow itself may have caused, is NOT a stop.
        ['crash while up: tier up, stacks complete', { wake: [0, 0], recipe: UP, food: UP }, 'false'],
        ['redeploy in flight', { wake: [0, 0], recipe: 'UPDATE_IN_PROGRESS', food: UP }, 'false'],
        ['rolling back after a bad deploy', { wake: [0, 0], recipe: 'UPDATE_ROLLBACK_IN_PROGRESS', food: UP }, 'false'],
        ['only ONE stack gone (a failed deploy, not a reclaim)', { wake: [0, 0], recipe: 'ABSENT', food: UP }, 'false'],
        ['status check errored, stacks up', { wake: [1, 1], recipe: UP, food: UP }, 'false'],
        ['stack lookup throttled: cannot tell', { wake: [0, 0], recipe: 'THROTTLED', food: 'THROTTLED' }, 'false'],
        // The confirmation: one reading is not proof.
        ['stopped on the first probe, up on the second', { wake: [3, 0], recipe: UP, food: UP }, 'false'],
    ];

    it.each(rows)('%s -> stopped=%s', (_label, world, expected) => {
        const outcome = stopped(world);

        expect(outcome.status, outcome.out).toBe(0);
        expect(outcome.stopped, outcome.out).toBe(expected);
        expect(outcome.out).toMatch(/^reason=/mu);
    });

    it('never consults health: the deploy gate is not run', () => {
        expect(stopped({ wake: [0, 0], recipe: UP, food: UP }).log).not.toContain('health was consulted');
        expect(stopped({ wake: [3, 3], recipe: UP, food: UP }).log).not.toContain('health was consulted');
    });

    it('asks twice before it says stopped', () => {
        const calls = stopped({ wake: [0, 0], recipe: 'ABSENT', food: 'ABSENT' })
            .log.split('\n')
            .filter(Boolean);

        expect(calls.filter((call) => call.includes(STACKS[0]))).toHaveLength(2);
    });

    it('refuses a call without a stage and a region', () => {
        expect(spawnSync('bash', [SCRIPT, 'stopped', 'pr-91'], { encoding: 'utf8' }).status).toBe(2);
    });
});
