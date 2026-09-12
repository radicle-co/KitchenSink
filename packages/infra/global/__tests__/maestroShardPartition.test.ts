// @vitest-environment node
/**
 * Repo-wide guard: **Maestro flow SHARDING** — the partition that splits one emulator run across N runners,
 * and the pool lanes that make the split safe.
 *
 * ## The measurement this exists for
 *
 * Run 35220684252's `e2e-mobile-maestro` was **47.35m**: **15.0m** of fixed per-runner setup (10.68m Gradle
 * release-APK build, 1.52m workspace build, 1.31m emulator boot + APK install, ~1.5m checkout/deps/secrets/seed)
 * and **32.2m of FLOW EXECUTION** across 23 flows. `maestroFlowSelection.test.ts` records the same 2:1 split on
 * the 34-flow plan (52.75m = 17.3m fixed + 35.5m flows). Selection narrows the flow half when a change can be
 * attributed; SHARDING divides it when it cannot — and a full run is the case selection cannot help.
 *
 * ## ⛔ WHY THIS IS NOT "just run the matrix twice"
 *
 * Every flow signs in as the Maestro tier's FIXED Clerk pool slots and the per-flow reset RECONCILES that
 * signer's library to the run manifest. Two shards on ONE signer is not a slow run, it is a DESTRUCTIVE one:
 * shard A's reset deletes the recipe shard B created a second ago, `resetPool` hard-deletes every user-keyed
 * row around each shard, and while a purge is in flight the service answers that principal's mutations with
 * `423 ERASURE_IN_PROGRESS`. So a shard is only safe if its identities are DISJOINT from every other shard's,
 * and that is what {@link maestroShardCapacity} bounds and what these tests assert in both directions:
 *
 *   - the shell's `MAESTRO_MAX_SHARDS` and the TypeScript roster's capacity agree (neither can typecheck the
 *     other, so the contract is asserted from disk — the posture `maestroFixtureVariables.test.ts` takes);
 *   - every shard's signer, co-author and erasure subject differ from every other shard's;
 *   - the workflow leases per SHARD (`test-pool-sandbox-maestro-{shard}`), not per tier, so the protection the
 *     single `test-pool-sandbox-maestro` group used to give is preserved one lane down rather than dropped.
 *
 * ## The two failure modes the partition must not have
 *
 * 1. **A flow that runs on NO shard.** That is `maestroFlowSelection.test.ts`'s cardinal sin one layer up: a
 *    green matrix over work nobody did. Every property below is stated over the UNION of the shards.
 * 2. **A shard with no session.** Each shard installs the APK on its OWN emulator and the runner never wipes
 *    the app between flows, so a shard that does not run the signed-out SPINE (`auth/loginFlow`) starts every
 *    flow signed out. The spine is therefore on EVERY shard, by construction, not by luck of the packing.
 *
 * ## Mutation evidence
 *
 * Written before `maestro_shard_flows` existed: every case below failed with the script's usage error. After
 * implementation, targeted mutations — dropping the spine from the per-shard set reds "every shard runs the
 * signed-out spine"; assigning by `index % count` instead of least-loaded reds the balance case;
 * emitting a flow on two shards reds the partition (union-with-multiplicity) case; letting `count=0` through
 * reds the refusal case.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
    consumableSlots,
    maestroConsumableSlots,
    maestroShardCapacity,
    maestroSlotForShard,
} from '@kitchensink/e2e-fixtures/testPool';

import { scalarText } from './workflowScalar.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const WORKFLOW = join(REPO_ROOT, '.github/workflows/_ci-heavy.yml');

/** The emulator job id, as `_ci-heavy.yml` names it (`maestroFlowSelection.test.ts` pins the same name). */
const MAESTRO_JOB = 'e2e-mobile-maestro';

/** The spine: the one signed-out flow, which every shard must re-establish a session with. */
const SPINE = 'auth/loginFlow';

interface Sharded {
    readonly flows: readonly string[];
    readonly deferred: readonly string[];
    readonly reason: string;
    readonly status: number;
    readonly stderr: string;
}

/**
 * Run one of the script's PURE subcommands.
 *
 * @param args - The subcommand and its arguments.
 * @returns Parsed `flow=` / `deferred=` / `reason=` output plus the exit status.
 * @sideEffect Spawns `bash`. Touches no device and no network.
 */
function run(...args: readonly string[]): Sharded {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const lines = (result.stdout ?? '').split('\n');
    const valuesOf = (key: string): readonly string[] =>
        lines.flatMap((line) => (line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : []));

    return {
        flows: valuesOf('flow'),
        deferred: valuesOf('deferred'),
        reason: valuesOf('reason')[0] ?? '',
        status: result.status ?? -1,
        stderr: result.stderr ?? '',
    };
}

/** The committed plan, as the script prints it: one `<vertical>:<flow>` entry per line. */
function planEntries(): readonly string[] {
    const result = spawnSync('bash', [SCRIPT, 'plan'], { encoding: 'utf8' });

    return (result.stdout ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/** Every flow the committed plan runs, in plan order. */
const PLANNED: readonly string[] = planEntries().map((entry) => entry.slice(entry.indexOf(':') + 1));

/** The flows a full run selects — the script's own answer, never a re-implementation. */
function fullSelection(): readonly string[] {
    const result = spawnSync('bash', [SCRIPT, 'select', 'full=true'], { encoding: 'utf8' });

    return (result.stdout ?? '')
        .split('\n')
        .flatMap((line) => (line.startsWith('flow=') ? [line.slice('flow='.length)] : []));
}

/** Shard a selection across `count` runners, returning each shard's flows. */
function shardAll(count: number, selection: readonly string[]): readonly (readonly string[])[] {
    return Array.from({ length: count }, (_, index) => {
        const outcome = run('shard', String(index + 1), String(count), ...selection);

        expect(outcome.status, `shard ${index + 1}/${count} failed: ${outcome.stderr}`).toBe(0);

        return outcome.flows;
    });
}

/** The shell's declared shard ceiling — the value the workflow's matrix is clamped by. */
function shellMaxShards(): number {
    const outcome = spawnSync('bash', [SCRIPT, 'max-shards'], { encoding: 'utf8' });

    return Number((outcome.stdout ?? '').trim());
}

const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as {
    on?: { workflow_call?: { inputs?: Record<string, { default?: unknown }> } };
    jobs?: Record<
        string,
        {
            strategy?: { 'fail-fast'?: unknown; matrix?: Record<string, unknown> };
            concurrency?: { group?: unknown; 'cancel-in-progress'?: unknown };
            steps?: readonly { name?: string; run?: unknown; env?: Record<string, unknown> }[];
        }
    >;
};

describe('the shell shard ceiling and the Clerk pool roster agree', () => {
    it('declares the same capacity on both sides of the language boundary', () => {
        expect(shellMaxShards()).toBe(maestroShardCapacity());
    });

    it('bounds capacity by the SCARCEST identity a shard needs, never by one of them', () => {
        const capacity = maestroShardCapacity();

        expect(capacity).toBeGreaterThanOrEqual(1);

        // Each of the three must resolve for every shard inside capacity …
        for (let shard = 1; shard <= capacity; shard += 1) {
            expect(() => maestroSlotForShard('signer', shard)).not.toThrow();
            expect(() => maestroSlotForShard('coauthor', shard)).not.toThrow();
            expect(maestroConsumableSlots(shard, capacity).length).toBeGreaterThan(0);
        }

        // … and the first shard PAST capacity must be unrepresentable, not silently wrapped onto shard 1.
        expect(() => maestroSlotForShard('signer', capacity + 1)).toThrow(/poolAdmin/u);
    });

    it('⛔ gives every shard DISJOINT identities — one shared signer is a data-destroying run, not a slow one', () => {
        const capacity = maestroShardCapacity();
        const addresses = Array.from({ length: capacity }, (_, index) => index + 1).flatMap((shard) => [
            maestroSlotForShard('signer', shard).email,
            maestroSlotForShard('coauthor', shard).email,
            ...maestroConsumableSlots(shard, capacity).map((slot) => slot.email),
        ]);

        expect(new Set(addresses).size).toBe(addresses.length);
    });

    it('draws every consumable stride from the roster, losing none and inventing none', () => {
        const capacity = maestroShardCapacity();
        const declared = consumableSlots('maestro').map((slot) => slot.id);
        const strided = Array.from({ length: capacity }, (_, index) =>
            maestroConsumableSlots(index + 1, capacity).map((slot) => slot.id),
        ).flat();

        expect([...strided].sort()).toStrictEqual([...declared].sort());
    });

    it('keeps shard 1 on the ORIGINAL addresses, so sharding re-provisions nobody already in Clerk', () => {
        expect(maestroSlotForShard('signer', 1).id).toBe('signer');
        expect(maestroSlotForShard('coauthor', 1).id).toBe('coauthor');
    });
});

describe('maestro_shard_flows — the partition', () => {
    const selection = fullSelection();

    it('finds its subject (non-vacuity: the committed plan is non-empty and the spine leads it)', () => {
        expect(PLANNED.length).toBeGreaterThan(10);
        expect(selection).toStrictEqual(PLANNED);
        expect(selection[0]).toBe(SPINE);
    });

    it('is the IDENTITY at one shard — an unsharded run must be byte-identical to today', () => {
        const outcome = run('shard', '1', '1', ...selection);

        expect(outcome.status).toBe(0);
        expect(outcome.flows).toStrictEqual(selection);
        expect(outcome.deferred).toStrictEqual([]);
    });

    it.each([2, 3, 4])('⛔ runs every selected flow exactly once across %i shards (plus the spine)', (count) => {
        const shards = shardAll(count, selection);
        const union = shards.flat();
        const nonSpine = union.filter((flow) => flow !== SPINE);

        // The spine is on every shard BY DESIGN; everything else is a true partition.
        expect(union.filter((flow) => flow === SPINE)).toHaveLength(count);
        expect([...nonSpine].sort()).toStrictEqual([...selection.filter((flow) => flow !== SPINE)].sort());
    });

    it.each([2, 3, 4])('⛔ runs the signed-out spine on every one of %i shards, first', (count) => {
        for (const flows of shardAll(count, selection)) {
            expect(flows[0]).toBe(SPINE);
        }
    });

    it.each([2, 3, 4])(
        'keeps each of %i shards a SUBSEQUENCE of the plan (intra-shard order is load-bearing)',
        (count) => {
            for (const flows of shardAll(count, selection)) {
                const positions = flows.map((flow) => selection.indexOf(flow));

                expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
                expect(positions.every((position) => position >= 0)).toBe(true);
            }
        },
    );

    it.each([2, 3, 4])('reports on each of %i shards exactly the flows the OTHER shards run', (count) => {
        for (let index = 1; index <= count; index += 1) {
            const outcome = run('shard', String(index), String(count), ...selection);
            const mine = new Set(outcome.flows);

            expect([...outcome.flows, ...outcome.deferred].sort()).toStrictEqual([...selection].sort());
            expect(outcome.deferred.some((flow) => mine.has(flow))).toBe(false);
        }
    });

    /**
     * ⛔ BALANCE IS THE WHOLE POINT, and this is the assertion that makes least-loaded packing a REQUIREMENT
     * rather than a preference. Measured over the committed weights (2,501s of non-spine flow time, 33 flows),
     * round-robin by position against least-loaded-first:
     *
     *     shards | round-robin        | least-loaded
     *        2   | 1200/1301  → 7.8%  | 1237/1264  →  2.1%
     *        3   | 1083/686/732 → 36.7% | 816/852/833 → 4.2%
     *        4   | 597/419/603/882 → 52.5% | 586/636/614/665 → 11.9%
     *
     * ⚠️ AND IT IS ASSERTED AT THREE COUNTS, not at two, BECAUSE OF THAT TABLE. At two shards round-robin is
     * only 7.8% out — inside any threshold loose enough to survive a weight edit — so a 2-shard-only case
     * PASSES the wrong algorithm. Measured: swapping the packing for `index % count` reds nothing at n=2 and
     * reds n=3 and n=4 immediately. The threshold has to be paired with a count where the difference shows.
     */
    it.each([2, 3, 4])('⛔ BALANCES %i shards by measured cost, not by flow count', (count) => {
        const weights = weightTable();
        const cost = (flows: readonly string[]): number =>
            flows.reduce((total, flow) => total + (weights.get(flow) ?? defaultWeight()), 0);
        const shards = shardAll(count, selection).map(cost);
        const [slowest, fastest] = [Math.max(...shards), Math.min(...shards)];

        expect((slowest - fastest) / slowest, `shard costs: ${shards.join('/')}`).toBeLessThan(0.15);
    });

    it('⛔ REFUSES a broken matrix rather than silently running a subset', () => {
        for (const [index, count] of [
            ['0', '2'],
            ['3', '2'],
            ['1', '0'],
            ['-1', '2'],
            ['x', '2'],
            ['1', 'y'],
        ] as const) {
            const outcome = run('shard', index, count, ...selection);

            expect(outcome.status, `shard ${index}/${count} was accepted`).not.toBe(0);
            expect(outcome.flows, `shard ${index}/${count} emitted flows`).toStrictEqual([]);
        }
    });

    it('⛔ REFUSES an empty selection at every shard count — a green shard over no flows is the whole sin', () => {
        for (const count of [1, 2, 3]) {
            const outcome = run('shard', '1', String(count));

            expect(outcome.status).not.toBe(0);
        }
    });

    it('shards a NARROWED selection too, and never strands a flow', () => {
        const narrowed = spawnSync('bash', [SCRIPT, 'select', 'collections=true'], { encoding: 'utf8' });
        const flows = (narrowed.stdout ?? '')
            .split('\n')
            .flatMap((line) => (line.startsWith('flow=') ? [line.slice('flow='.length)] : []));

        expect(flows.length).toBeGreaterThan(2);

        const union = shardAll(2, flows).flat();

        expect([...union.filter((flow) => flow !== SPINE)].sort()).toStrictEqual(
            [...flows.filter((flow) => flow !== SPINE)].sort(),
        );
    });
});

describe('maestro_shard_matrix — how many shards the workflow actually runs', () => {
    it('never emits an empty matrix, and never more shards than the pool can identify', () => {
        for (const requested of ['0', '1', '2', '3', '99', '', 'nonsense']) {
            const outcome = spawnSync('bash', [SCRIPT, 'shard-matrix', requested], { encoding: 'utf8' });
            const matrix = JSON.parse((outcome.stdout ?? '').trim()) as number[];

            expect(outcome.status, `requested '${requested}' failed: ${outcome.stderr ?? ''}`).toBe(0);
            expect(matrix.length).toBeGreaterThanOrEqual(1);
            expect(matrix.length).toBeLessThanOrEqual(shellMaxShards());
            expect(matrix).toStrictEqual(Array.from({ length: matrix.length }, (_, index) => index + 1));
        }
    });

    /**
     * ⛔ CLAMPED TO THE PACKABLE WORK TOO, not just to the pool. The spine runs on every shard, so a selection
     * of "spine plus one flow" cannot fill two runners — the second would boot an emulator, install an APK and
     * run the sign-in flow a second time to prove nothing new. The clamp derives the spine count from the PLAN
     * (`spine:` labels) rather than from the name `auth/loginFlow`, so it cannot disagree with the partition
     * about which flows every shard already runs.
     */
    it('⛔ clamps to the PACKABLE flows, so a narrow selection never boots a spine-only runner', () => {
        const matrixFor = (...selector: readonly string[]): number[] =>
            JSON.parse(
                (
                    spawnSync('bash', [SCRIPT, 'shard-matrix', '4', ...selector], { encoding: 'utf8' }).stdout ?? ''
                ).trim(),
            ) as number[];
        const nonSpine = (...selector: readonly string[]): number =>
            (spawnSync('bash', [SCRIPT, 'select', ...selector], { encoding: 'utf8' }).stdout ?? '')
                .split('\n')
                .filter((line) => line.startsWith('flow=') && line !== `flow=${SPINE}`).length;

        // `home` is the ONE-flow vertical: spine + home, so exactly one flow is packable and one shard can hold it.
        expect(nonSpine('home=true')).toBe(1);
        expect(matrixFor('home=true')).toStrictEqual([1]);
        // `collections` has five, so it fills every shard the pool can identify.
        expect(nonSpine('collections=true')).toBeGreaterThan(shellMaxShards());
        expect(matrixFor('collections=true')).toHaveLength(shellMaxShards());
    });

    it('clamps an unreadable request DOWN to one shard rather than guessing — a wrong matrix is a wrong lease', () => {
        for (const requested of ['', 'nonsense', '-4', '0']) {
            const outcome = spawnSync('bash', [SCRIPT, 'shard-matrix', requested], { encoding: 'utf8' });

            expect(JSON.parse((outcome.stdout ?? '').trim())).toStrictEqual([1]);
        }
    });
});

describe('_ci-heavy.yml wires the shards without loosening a single gate', () => {
    const job = workflow.jobs?.[MAESTRO_JOB];

    it('runs the emulator tier as a matrix that never cancels its sibling shard', () => {
        expect(job, `_ci-heavy.yml has no ${MAESTRO_JOB} job`).toBeDefined();
        expect(scalarText(job?.strategy?.matrix?.['shard'])).toMatch(/fromJSON/u);
        expect(job?.strategy?.['fail-fast'], 'a failing shard must not cancel the other shards').toBe(false);
    });

    it('⛔ leases per SHARD — the protection the single tier-wide group used to give, one lane down', () => {
        expect(scalarText(job?.concurrency?.group)).toBe('test-pool-sandbox-maestro-${{ matrix.shard }}');
        expect(job?.concurrency?.['cancel-in-progress']).toBe(false);
    });

    /**
     * ⛔ THE SHARD COUNT AND THE MATRIX COME FROM ONE ANSWER, and `strategy.job-total` is the plausible source
     * that must NOT be used. The partition takes `(index, count)`; if `count` ever exceeded the real matrix
     * size, every running shard would pack for MORE shards than exist and the absent shard's flows would run
     * NOWHERE — silently, behind a green matrix, which is precisely the class the selection guard one file over
     * exists to make impossible. Both values therefore read the SAME `resolve-mobile-target` output, so they
     * cannot disagree. (The opposite error is safe by construction: a count smaller than the matrix makes the
     * last shard's `index > count`, which the partition refuses outright — asserted above.)
     */
    it('⛔ takes the shard COUNT from the same job output the matrix is built from, never strategy.job-total', () => {
        const emulator = (job?.steps ?? []).find((step) =>
            /runMaestroFlows\.sh/u.test(
                scalarText(step.run) + scalarText((step as { with?: { script?: unknown } }).with?.script),
            ),
        );
        const matrix = scalarText(job?.strategy?.matrix?.['shard']);
        const count = scalarText(emulator?.env?.['MAESTRO_SHARD_COUNT']);

        expect(emulator, 'no step runs runMaestroFlows.sh').toBeDefined();
        expect(scalarText(emulator?.env?.['MAESTRO_SHARD_INDEX'])).toMatch(/matrix\.shard/u);
        expect(count, 'MAESTRO_SHARD_COUNT must not come from strategy.job-total').not.toMatch(/strategy\./u);
        expect(count).toMatch(/needs\.resolve-mobile-target\.outputs\.maestro_shard_count/u);
        // …and the matrix must read the SIBLING output of that same step, so one `shard-matrix` answer feeds both.
        expect(matrix).toMatch(/needs\.resolve-mobile-target\.outputs\.maestro_shards/u);

        const resolve = workflow.jobs?.['resolve-mobile-target'] as
            { readonly outputs?: Record<string, unknown> } | undefined;
        const shardsOutput = scalarText(resolve?.outputs?.['maestro_shards']);
        const countOutput = scalarText(resolve?.outputs?.['maestro_shard_count']);

        expect(shardsOutput, 'the matrix output must come from a step').toMatch(/^\$\{\{ steps\.(\w+)\./u);
        expect(countOutput.replace('.count', '.shards')).toBe(shardsOutput);
    });

    it('⛔ tells every seed, reset and emulator step WHICH shard it is — a step that guesses leases the wrong slot', () => {
        const shardAware = (job?.steps ?? []).filter((step) => {
            const body = scalarText(step.run);

            return /e2e-seed\/src\/(provision|resetPool)\.ts|runMaestroFlows\.sh/u.test(body);
        });

        expect(shardAware.length, 'no seed/reset/emulator step found').toBeGreaterThanOrEqual(3);

        for (const step of shardAware) {
            expect(
                scalarText(step.env?.['COMMISE_E2E_SHARD']),
                `${step.name ?? '(unnamed)'} does not bind COMMISE_E2E_SHARD`,
            ).toMatch(/matrix\.shard/u);
        }
    });

    it('declares the shard count as an input whose default the pool can actually identify', () => {
        const input = workflow.on?.workflow_call?.inputs?.['maestro_shards'];

        expect(input, '_ci-heavy.yml declares no `maestro_shards` input').toBeDefined();
        expect(Number(scalarText(input?.default))).toBeLessThanOrEqual(maestroShardCapacity());
        expect(Number(scalarText(input?.default))).toBeGreaterThanOrEqual(1);
    });

    /**
     * ⛔ THE ROLLBACK PATH IS REACHABLE FROM THE FORM, not only from a commit. Two shards need two Clerk
     * signer/co-author pairs to exist; until `poolAdmin --apply` has created them the tier fails at its first
     * pool lease. `maestro_shards: 1` restores the pre-sharding tier exactly, so the manual door must be able
     * to say it — and every link of the relay must pass the value ON, because a link that drops it silently
     * restores the callee's default and the operator's choice is lost without a word.
     */
    it('⛔ relays the shard count from the manual door to the tier, with agreeing defaults', () => {
        const chain = [
            { file: 'deployedE2e.yml', event: 'workflow_dispatch' as const, relayTo: 'deployedE2eTiers.yml' },
            { file: 'deployedE2eTiers.yml', event: 'workflow_call' as const, relayTo: '_ci-heavy.yml' },
        ];

        for (const { file, event, relayTo } of chain) {
            const doc = parse(readFileSync(join(REPO_ROOT, '.github/workflows', file), 'utf8')) as {
                on?: Record<string, { inputs?: Record<string, { default?: unknown; type?: unknown }> }>;
                jobs?: Record<string, { uses?: unknown; with?: Record<string, unknown> }>;
            };
            const declared = doc.on?.[event]?.inputs?.['maestro_shards'];

            expect(declared, `${file} declares no maestro_shards on ${event}`).toBeDefined();
            // ⚠️ `workflow_dispatch` has NO number type, so the whole relay is text and `shard-matrix` parses
            // it. A `number` anywhere in the chain would refuse the manual door's value at dispatch time.
            expect(scalarText(declared?.type), `${file} must relay maestro_shards as a string`).toBe('string');
            expect(Number(scalarText(declared?.default)), `${file}'s default`).toBe(
                Number(scalarText(workflow.on?.workflow_call?.inputs?.['maestro_shards']?.default)),
            );

            const relaying = Object.values(doc.jobs ?? {}).filter((job) =>
                scalarText(job.uses).endsWith(`/${relayTo}`),
            );

            expect(relaying.length, `${file} calls ${relayTo} nowhere`).toBeGreaterThan(0);
            expect(
                relaying.some((job) => scalarText(job.with?.['maestro_shards']) === '${{ inputs.maestro_shards }}'),
                `${file} calls ${relayTo} without passing maestro_shards on`,
            ).toBe(true);
        }
    });
});

/** The script's committed per-flow cost hints, in seconds. */
function weightTable(): ReadonlyMap<string, number> {
    const outcome = spawnSync('bash', [SCRIPT, 'weights'], { encoding: 'utf8' });

    return new Map(
        (outcome.stdout ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.includes('='))
            .map((line) => [line.slice(0, line.indexOf('=')), Number(line.slice(line.indexOf('=') + 1))] as const),
    );
}

/** The weight the script assumes for a flow nobody has timed. */
function defaultWeight(): number {
    const outcome = spawnSync('bash', [SCRIPT, 'default-weight'], { encoding: 'utf8' });

    return Number((outcome.stdout ?? '').trim());
}

describe('the cost hints stay honest', () => {
    it('⛔ times only flows the plan actually runs — a stale entry mis-packs every shard, silently', () => {
        const planned = new Set(PLANNED);

        for (const flow of weightTable().keys()) {
            expect(planned.has(flow), `${flow} carries a cost hint but is not in the plan`).toBe(true);
        }
    });

    it('assumes a positive cost for an untimed flow, so a new flow is packed rather than treated as free', () => {
        expect(defaultWeight()).toBeGreaterThan(0);
    });
});
