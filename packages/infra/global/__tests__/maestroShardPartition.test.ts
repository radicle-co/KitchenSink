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
 *   - every shard's signer and co-author differ from every other shard's, and only the ERASURE shard holds erasure
 *     subjects — the runner pins every erasing flow to that shard (`maestroErasureSlots` states the lease contract);
 *   - the workflow leases per (PLATFORM, SHARD) (`test-pool-sandbox-maestro-{shard}` for Android,
 *     `test-pool-sandbox-maestro-ios-{shard}` for iOS), not per tier, so the protection the single
 *     `test-pool-sandbox-maestro` group used to give is preserved one lane down rather than dropped.
 *
 * REWRITTEN 2026-10-13 (owner: "do all three" — iOS lanes of its own, four shards per platform): the roster and the
 * shell ceiling are now per PLATFORM, so Android and iOS each reach four disjoint shards and the two jobs no longer
 * queue on one group. Every seed, reset and refill step now states its platform on BOTH channels.
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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import {
    consumableSlots,
    MAESTRO_ERASURE_SHARD,
    MAESTRO_PLATFORMS,
    maestroErasureSlots,
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
    /**
     * REWRITTEN 2026-10-13: one shell number bounds BOTH platforms, so it must equal each platform's own capacity —
     * a roster where Android reached four and iOS two would make the shell's `4` over-promise on iOS.
     */
    it.each(MAESTRO_PLATFORMS)(
        'declares the same capacity on both sides of the language boundary, for %s',
        (platform) => {
            expect(shellMaxShards()).toBe(maestroShardCapacity(platform));
        },
    );

    /**
     * REWRITTEN 2026-10-08 with the erasure lane: a shard no longer needs an erasure subject of its own, so only the
     * signer and the co-author bound capacity, and the erasure shard alone must hold subjects. Per platform since
     * 2026-10-13.
     */
    it.each(MAESTRO_PLATFORMS)(
        'bounds %s capacity by the scarcer identity EVERY shard needs, and gives the erasure shard its subjects',
        (platform) => {
            const capacity = maestroShardCapacity(platform);

            expect(capacity).toBeGreaterThanOrEqual(1);
            expect(MAESTRO_ERASURE_SHARD).toBeLessThanOrEqual(capacity);
            expect(maestroErasureSlots(platform, MAESTRO_ERASURE_SHARD).length).toBeGreaterThan(0);

            for (let shard = 1; shard <= capacity; shard += 1) {
                expect(() => maestroSlotForShard('signer', platform, shard)).not.toThrow();
                expect(() => maestroSlotForShard('coauthor', platform, shard)).not.toThrow();
            }

            // … and the first shard PAST capacity must be unrepresentable, not silently wrapped onto shard 1.
            expect(() => maestroSlotForShard('signer', platform, capacity + 1)).toThrow(/poolAdmin/u);
        },
    );

    it('⛔ gives every (platform, shard) lane DISJOINT identities — one shared signer is a data-destroying run, not a slow one', () => {
        const addresses = MAESTRO_PLATFORMS.flatMap((platform) =>
            Array.from({ length: maestroShardCapacity(platform) }, (_, index) => index + 1).flatMap((shard) => [
                maestroSlotForShard('signer', platform, shard).email,
                maestroSlotForShard('coauthor', platform, shard).email,
                ...maestroErasureSlots(platform, shard).map((slot) => slot.email),
            ]),
        );

        expect(new Set(addresses).size).toBe(addresses.length);
    });

    it('⛔ hands each platform’s erasure shard ITS OWN five subjects and every other shard none — all ten usable, one eraser per platform', () => {
        const held = MAESTRO_PLATFORMS.flatMap((platform) =>
            Array.from({ length: maestroShardCapacity(platform) }, (_, index) => ({
                platform,
                shard: index + 1,
                ids: maestroErasureSlots(platform, index + 1).map((slot) => slot.id),
            })),
        );
        const erasers = held.filter(({ shard }) => shard === MAESTRO_ERASURE_SHARD);

        expect(erasers.flatMap(({ ids }) => ids)).toStrictEqual(consumableSlots('maestro').map((slot) => slot.id));
        expect(erasers.every(({ ids }) => ids.length === 5)).toBe(true);
        expect(held.filter(({ shard }) => shard !== MAESTRO_ERASURE_SHARD).flatMap(({ ids }) => ids)).toStrictEqual([]);
    });

    it('keeps Android shard 1 on the ORIGINAL addresses, so the split re-provisions nobody already in Clerk', () => {
        expect(maestroSlotForShard('signer', 'android', 1).id).toBe('signer');
        expect(maestroSlotForShard('coauthor', 'android', 1).id).toBe('coauthor');
    });
});

/**
 * THE ERASURE LANE, the runner's side (2026-10-08; per platform since 2026-10-13). `testPool.ts`'s
 * `maestroErasureSlots` gives each platform's erasure subjects to ONE shard of that platform, and that is safe only if every flow that erases runs on THAT shard and nowhere else: the shard's
 * concurrency lane is the only thing keeping two jobs from leasing the same subject. Least-loaded packing used to
 * decide where `accountErasure` landed — always shard 2 on a full run, and on whichever shard was lightest on a
 * narrowed one, which differs between platforms because their exclusions differ.
 */
describe('maestro_shard_flows — every erasing flow is pinned to the erasure shard', () => {
    const shell = (...args: readonly string[]): string =>
        (spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' }).stdout ?? '').trim();
    const erasing = shell('erasing-flows')
        .split('\n')
        .filter((line) => line.length > 0);

    /** A planned flow ERASES when its own YAML — comments aside — interpolates the leased erasure subject. */
    const derivedErasing = PLANNED.filter((flow) =>
        readFileSync(join(REPO_ROOT, 'packages/apps/commise/mobile/.maestro', `${flow}.yaml`), 'utf8')
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#'))
            .some((line) => line.includes('${E2E_ERASURE_EMAIL}')),
    );

    it('finds its subject (non-vacuity: the plan has an erasing flow, and the shell names it)', () => {
        expect(derivedErasing).toContain('accountErasure');
        expect(erasing.length).toBeGreaterThan(0);
    });

    it('⛔ names exactly the flows whose YAML erases — in both directions, so none can be packed loose', () => {
        expect([...erasing].sort()).toStrictEqual([...derivedErasing].sort());
    });

    it('declares the same erasure shard on both sides of the language boundary', () => {
        expect(Number(shell('erasure-shard'))).toBe(MAESTRO_ERASURE_SHARD);
    });

    const platforms = shell('platforms').split('\n');
    const selectors: readonly (readonly string[])[] = [
        ['full=true'],
        ...shell('verticals')
            .split('\n')
            .map((vertical) => [`${vertical}=true`]),
    ];
    const cases = platforms.flatMap((platform) =>
        selectors.flatMap((selector) =>
            Array.from({ length: shellMaxShards() }, (_, index) => [platform, selector.join(' '), index + 1] as const),
        ),
    );

    it.each(cases)(
        '⛔ %s, selector %s, %i shard(s): an erasing flow runs ONLY on the erasure shard, and runs LAST there',
        (platform, selector, count) => {
            const shards = Array.from({ length: count }, (_, index) => {
                const outcome = spawnSync(
                    'bash',
                    [SCRIPT, 'shard-selection', String(index + 1), String(count), ...selector.split(' ')],
                    { encoding: 'utf8', env: { ...process.env, MAESTRO_PLATFORM: platform } },
                );

                expect(outcome.status, outcome.stderr ?? '').toBe(0);

                return (outcome.stdout ?? '')
                    .split('\n')
                    .flatMap((line) => (line.startsWith('flow=') ? [line.slice('flow='.length)] : []));
            });

            for (const flow of erasing) {
                const holders = shards.flatMap((flows, index) => (flows.includes(flow) ? [index + 1] : []));

                if (holders.length === 0) {
                    continue;
                }

                expect(holders, `${flow} ran on shard(s) ${holders.join(',')}`).toStrictEqual([MAESTRO_ERASURE_SHARD]);
                expect(shards[MAESTRO_ERASURE_SHARD - 1]?.at(-1)).toBe(flow);
            }
        },
    );

    it('is exercised: a full run on every platform does select an erasing flow', () => {
        for (const platform of platforms) {
            const outcome = spawnSync('bash', [SCRIPT, 'shard-selection', '1', String(shellMaxShards()), 'full=true'], {
                encoding: 'utf8',
                env: { ...process.env, MAESTRO_PLATFORM: platform },
            });

            expect(outcome.stdout ?? '', platform).toMatch(new RegExp(`^flow=${erasing[0] ?? '-'}$`, 'mu'));
        }
    });
});

/**
 * ⛔ THE RUNNER REFUSES AN ERASING FLOW WHEN THE MANIFEST NAMES NO SUBJECT. Only the erasure shard leases one, so every
 * other shard's manifest omits `E2E_ERASURE_EMAIL`. What Maestro does with an unresolved `${E2E_ERASURE_EMAIL}` inside
 * `signinHome.yaml`'s `env:` override is not something this repository can verify — and if it fell back to the
 * parent's `E2E_SIGNIN_EMAIL`, the flow would erase the SIGNER every later flow signs in as. So the runner decides
 * first, by EXECUTING the subcommand the loop calls (`maestroDriverLifecycle.integration.test.ts` proves the loop
 * calls it before the reset and before `maestro test`).
 */
describe('runMaestroFlows.sh erasure-subject — the refusal', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'maestro-erasure-subject-'));

    afterAll(() => {
        rmSync(scratch, { recursive: true, force: true });
    });

    const manifest = (lines: readonly string[]): string => {
        const file = join(scratch, `fixture-${lines.length}-${Math.random().toString(36).slice(2)}.env`);

        writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

        return file;
    };

    const check = (flow: string, file: string) =>
        spawnSync('bash', [SCRIPT, 'erasure-subject', flow], {
            encoding: 'utf8',
            env: { ...process.env, MAESTRO_FIXTURE_ENV_FILE: file },
        });
    const signer = 'E2E_SIGNIN_EMAIL=test-signer02+clerk_test@radcile.com';

    it('⛔ refuses an erasing flow on a manifest that names no subject', () => {
        const outcome = check('accountErasure', manifest([signer]));

        expect(outcome.status).not.toBe(0);
        expect(`${outcome.stdout ?? ''}${outcome.stderr ?? ''}`).toMatch(/::error::/u);
    });

    it('⛔ refuses an erasing flow on a manifest whose subject is BLANK', () => {
        expect(check('accountErasure', manifest([signer, 'E2E_ERASURE_EMAIL='])).status).not.toBe(0);
    });

    it('⛔ refuses an erasing flow when there is no manifest at all', () => {
        expect(check('accountErasure', join(scratch, 'absent.env')).status).not.toBe(0);
    });

    it('admits an erasing flow on a manifest that names its subject', () => {
        const outcome = check(
            'accountErasure',
            manifest([signer, 'E2E_ERASURE_EMAIL=test-erasure07+clerk_test@radcile.com']),
        );

        expect(outcome.status, `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`).toBe(0);
    });

    it('admits every non-erasing flow whatever the manifest says', () => {
        expect(check('recipes/delete', manifest([signer])).status).toBe(0);
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

/**
 * The sharded Maestro jobs — one per platform — and the resolver outputs each one's matrix and count come from.
 *
 * ⚠️ EACH JOB HOLDS ITS OWN CONCURRENCY GROUP (2026-10-13; it REPLACES the shared one). The roster now has lanes per
 * PLATFORM, so "iOS shard 2" signs in as `iossigner02` and "Android shard 2" as `signer02`: they share no Clerk user
 * and no longer need to exclude each other. What each group still excludes is two RUNS' same-platform same-shard job,
 * which do share a user. Android keeps the original name so a run of older code on another branch still excludes it.
 */
const SHARDED_JOBS = [
    {
        job: MAESTRO_JOB,
        platform: 'android',
        shards: 'maestro_shards',
        count: 'maestro_shard_count',
        group: 'test-pool-sandbox-maestro-${{ matrix.shard }}',
    },
    {
        job: 'e2e-mobile-maestro-ios',
        platform: 'ios',
        shards: 'maestro_ios_shards',
        count: 'maestro_ios_shard_count',
        group: 'test-pool-sandbox-maestro-ios-${{ matrix.shard }}',
    },
] as const;

describe.each(SHARDED_JOBS)('_ci-heavy.yml::$job wires the shards without loosening a single gate', (wiring) => {
    const job = workflow.jobs?.[wiring.job];

    it('runs the emulator tier as a matrix that never cancels its sibling shard', () => {
        expect(job, `_ci-heavy.yml has no ${wiring.job} job`).toBeDefined();
        expect(scalarText(job?.strategy?.matrix?.['shard'])).toMatch(/fromJSON/u);
        expect(job?.strategy?.['fail-fast'], 'a failing shard must not cancel the other shards').toBe(false);
    });

    it('⛔ leases per (platform, SHARD) — the protection the single tier-wide group used to give, one lane down', () => {
        expect(scalarText(job?.concurrency?.group)).toBe(wiring.group);
        expect(job?.concurrency?.['cancel-in-progress']).toBe(false);
    });

    /**
     * ADDED 2026-10-13: the two jobs' groups must never be the same string, or the platforms queue on one lane again
     * (the 36-minute wait this change removes), and no iOS group may be a name an Android group can also take.
     */
    it('⛔ holds a group no other Maestro job’s group can equal, for any shard', () => {
        const others = SHARDED_JOBS.filter((other) => other.job !== wiring.job);

        for (const other of others) {
            for (const shard of [1, 2, 3, 4]) {
                const mine = scalarText(job?.concurrency?.group).replace('${{ matrix.shard }}', String(shard));
                const theirs = scalarText(workflow.jobs?.[other.job]?.concurrency?.group).replace(
                    '${{ matrix.shard }}',
                    String(shard),
                );

                expect(mine, `${wiring.job} and ${other.job} share a lane at shard ${shard}`).not.toBe(theirs);
            }
        }
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
        expect(count).toBe(`\${{ needs.resolve-mobile-target.outputs.${wiring.count} }}`);
        // …and the matrix must read the SIBLING output of that same step, so one `shard-matrix` answer feeds both.
        expect(matrix).toMatch(new RegExp(`needs\\.resolve-mobile-target\\.outputs\\.${wiring.shards}\\b`, 'u'));

        const resolve = workflow.jobs?.['resolve-mobile-target'] as
            | {
                  readonly outputs?: Record<string, unknown>;
                  readonly steps?: readonly { id?: string; run?: unknown; env?: Record<string, unknown> }[];
              }
            | undefined;
        const shardsOutput = scalarText(resolve?.outputs?.[wiring.shards]);
        const countOutput = scalarText(resolve?.outputs?.[wiring.count]);

        expect(shardsOutput, 'the matrix output must come from a step').toMatch(/^\$\{\{ steps\.(\w+)\./u);
        expect(countOutput.replace('.count', '.shards')).toBe(shardsOutput);

        // ⛔ …and that step must size the matrix for THIS job's platform. An iOS matrix sized from Android's flow
        // count hands an iOS shard nothing but the spine whenever iOS excludes enough of a narrowed selection.
        const stepId = /^\$\{\{ steps\.(\w+)\./u.exec(shardsOutput)?.[1];
        const producer = resolve?.steps?.find((step) => step.id === stepId);

        expect(scalarText(producer?.run)).toMatch(/runMaestroFlows\.sh[\s\\]*shard-matrix/u);
        expect(scalarText(producer?.env?.['MAESTRO_PLATFORM']), `${stepId} must state its platform`).toBe(
            wiring.platform,
        );
        // The step that RUNS the flows states the same platform, so the matrix and the partition agree.
        expect(scalarText(emulator?.env?.['MAESTRO_PLATFORM'])).toBe(wiring.platform);
    });

    /**
     * ADDED 2026-10-13. The platform is the second axis of the lane, and a step that left it to a default would lease
     * Android's signer on an iOS job. Every step that seeds or resets states it on BOTH channels — `MAESTRO_PLATFORM`
     * in its env (which `provision` and the per-flow reset read) and, where the command takes one, `--platform` on its
     * command line (`resetPool` and `poolAdmin`) — as the SAME literal this job's platform, which `resetPool` then
     * asserts agree before its first purge.
     */
    it('⛔ states this job’s PLATFORM on every seed and reset step, in the env and on the command line', () => {
        const flagged = (job?.steps ?? []).filter((step) => /resetPool\.ts|poolAdmin\.ts/u.test(scalarText(step.run)));
        const provisioning = (job?.steps ?? []).filter((step) => /provision\.ts/u.test(scalarText(step.run)));

        expect(flagged.length, 'two resets and a refill').toBe(3);
        expect(provisioning).toHaveLength(1);

        for (const step of flagged) {
            const body = scalarText(step.run);

            expect(body, `${step.name ?? '(unnamed)'} does not pass --platform ${wiring.platform}`).toMatch(
                new RegExp(`--platform ${wiring.platform}\\b`, 'u'),
            );
            expect(body).not.toMatch(new RegExp(`--platform (?!${wiring.platform}\\b)`, 'u'));
        }

        // The refill takes the platform from its command line alone — `poolAdmin` reads no environment for it.
        for (const step of [
            ...flagged.filter((step) => /resetPool\.ts/u.test(scalarText(step.run))),
            ...provisioning,
        ]) {
            expect(
                scalarText(step.env?.['MAESTRO_PLATFORM']),
                `${step.name ?? '(unnamed)'} does not bind MAESTRO_PLATFORM`,
            ).toBe(wiring.platform);
        }
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
});

describe('_ci-heavy.yml declares and relays the shard count', () => {
    it('declares the shard count as an input whose default the pool can actually identify', () => {
        const input = workflow.on?.workflow_call?.inputs?.['maestro_shards'];

        expect(input, '_ci-heavy.yml declares no `maestro_shards` input').toBeDefined();

        for (const platform of MAESTRO_PLATFORMS) {
            expect(Number(scalarText(input?.default))).toBeLessThanOrEqual(maestroShardCapacity(platform));
        }

        expect(Number(scalarText(input?.default))).toBeGreaterThanOrEqual(1);
    });

    /**
     * ADDED 2026-10-13 (phase 5 of the speed-up): the default is the platform's full capacity — FOUR — on all three files that
     * carry it, and the manual door's form says so too. The three-part act is complete (roster lanes appended, `poolAdmin
     * --apply` run by the coordinator on 2026-10-13, `MAESTRO_MAX_SHARDS` raised), and this is the "move the defaults LAST"
     * step. Rolling back is setting all three back to the lower number; this assertion is part of that commit by design,
     * so a half-rollback (one file) is red here and in the agreement test below.
     */
    it('⛔ defaults to four shards per platform in all three files, because the pool can now identify four', () => {
        const defaults = ['_ci-heavy.yml', 'deployedE2eTiers.yml', 'deployedE2e.yml'].map((file) => {
            const doc = parse(readFileSync(join(REPO_ROOT, '.github/workflows', file), 'utf8')) as {
                on?: Record<string, { inputs?: Record<string, { default?: unknown }> }>;
            };
            const input = (doc.on?.['workflow_call'] ?? doc.on?.['workflow_dispatch'])?.inputs?.['maestro_shards'];

            return [file, scalarText(input?.default)] as const;
        });

        expect(defaults).toEqual([
            ['_ci-heavy.yml', '4'],
            ['deployedE2eTiers.yml', '4'],
            ['deployedE2e.yml', '4'],
        ]);

        for (const platform of MAESTRO_PLATFORMS) {
            expect(maestroShardCapacity(platform)).toBe(4);
        }
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
