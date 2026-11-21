/**
 * One local Maestro lane run, over one or both platforms, from the host lock to the worst lane's exit code.
 *
 * The order is the contract (`maestroLanesBlueprint.md` §1 and §3). Take the host lock. Select and plan each platform,
 * so a run over no flows or no lane users starts nothing. Start the shared services ONCE for every platform. Make the
 * run's own users (each platform's erasure subject, its id recorded). Reset and set up every lane of every platform ONE
 * AT A TIME. Prepare each host and boot every device at once. Start every lane, staggered across both platforms (Clerk
 * limits sign-ins per IP, and each lane signs in once). Wait for all of them. Reset every lane again while the services
 * are up. Then stop the services, delete the run's users by their recorded ids, and stop the devices and the lock, in
 * that order, whatever failed on the way. An abort (Ctrl-C) between phases skips the rest and cleans up.
 *
 * @pattern Facade — one call over the lock, the planner, the Supervisor, the device Strategies and the lane processes
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { inspect } from 'node:util';

import { planLanes } from '@kitchensink/e2e-plan';
import type { FlowResult } from '@kitchensink/e2e-plan/recordedScreens';
import type { Env } from '@kitchensink/e2e-plan/stampRun';

import { failureEvidenceDir, pruneFailureRuns } from './failureEvidence.js';
import type { HostLock } from './hostLock.js';
import type { StagedOneOffs } from './oneOffStage.js';
import { fitLaneCount, flowSelector, laneSpecs } from './lanePlanning.js';
import { laneRunnerEnv, type LaneChild } from './laneProcess.js';
import type { DeviceAdapter, LanePlatform, LaneSpec } from './laneTypes.js';
import type { SharedServices } from './sharedServices.js';
import { KILL_WAIT_MS, STOP_GRACE_MS, stopTargets, type StopSignal } from './stopGroups.js';

/** `all`, or the flows to run. An empty list selects nothing: it is never read as `all`. */
export type Selection = 'all' | readonly string[];

export interface LaneRunRequest {
    readonly platforms: readonly LanePlatform[];
    /** `--lanes`: it can only lower each platform's count. */
    readonly requested?: number;
    /** The flows named on the command line or `all` for every platform, or the impact selector's answer for each. */
    readonly selection: Selection | Readonly<Record<LanePlatform, Selection>>;
    /**
     * The staged one-off flow ids (`oneOffStage`). When given, a platform runs only these: the selector is not asked,
     * every lane is handed the ids, and the green stamp does not move.
     */
    readonly oneOffs?: readonly string[];
}

const selectionFor = (selection: LaneRunRequest['selection'], platform: LanePlatform): Selection =>
    typeof selection === 'object' && !('length' in selection) ? selection[platform] : selection;

/** What a settled platform hands the green stamp: the flows its lanes were given and how each ended. */
interface StampSettlement {
    readonly platform: LanePlatform;
    /** The flows the lanes were given. Empty when nothing was selected or nothing selected can run locally. */
    readonly flows: readonly string[];
    /** The sandbox-only flows this run dropped. */
    readonly owed: readonly string[];
    readonly results: ReadonlyMap<string, FlowResult>;
    /** Whether the screen check found nothing wrong. */
    readonly recorderClean: boolean;
}

/** What the screen check found: the exit code it adds, and each platform's flows by recorded result. */
interface ScreenOutcome {
    readonly code: number;
    readonly results: ReadonlyMap<string, ReadonlyMap<string, FlowResult>>;
}

/** What the run needs from the world, injected so its order and its exits are testable without devices. */
export interface LaneRunDeps {
    adapterFor(platform: LanePlatform): DeviceAdapter;
    readonly stateDir: string;
    /** This run's start time as a folder name: the lanes keep a failed flow's evidence under it. */
    readonly runStamp: string;
    readonly repoRoot: string;
    readonly lockDir: string;
    readonly baseEnv: Env;
    acquireLock(): HostLock;
    /** The flows this platform's lanes run for a selector (the runner's own selection, platform and local filters). */
    selectFlows(
        platform: LanePlatform,
        selector: string,
    ): Promise<{
        readonly flows: readonly string[];
        readonly notes: readonly string[];
        /** The selected sandbox-only flows the local filter dropped. */
        readonly owed: readonly string[];
    }>;
    /** The runner's packer: lane `index` of `count`'s flows on a platform. */
    pack(platform: LanePlatform, index: number, count: number, flows: readonly string[]): Promise<readonly string[]>;
    /** How many lanes, from lane 1, have their Clerk users. */
    identityCap(platform: LanePlatform): Promise<number>;
    startServices(): Promise<SharedServices>;
    /**
     * Make the users that exist only for this run (each platform's erasure subject), recording each id as it is made.
     * Called once the services are up, before any lane is reset or leases a user.
     */
    createRunUsers(platforms: readonly LanePlatform[]): Promise<void>;
    /** Delete the users this run recorded, by id. Called after the services stop, whatever failed before. */
    removeRunUsers(platforms: readonly LanePlatform[]): Promise<void>;
    /** After the lane's pool reset: align its identities and provision its world into its manifest. */
    setupLane(lane: LaneSpec, env: Env): Promise<void>;
    spawnLane(lane: LaneSpec, env: Env): LaneChild;
    /**
     * After the lanes exit: checks the screens their flows showed against the registry. Its code folds into the run's
     * exit code; its results say how each flow ended.
     */
    checkScreens(lanes: readonly LaneSpec[]): Promise<ScreenOutcome>;
    /**
     * Once per planned platform, after the check, unless the operator stopped the run: moves the green stamp if the run
     * earned it. It must not throw for a stamp that stays: that never changes the exit code.
     */
    settleStamp(settlement: StampSettlement): Promise<void>;
    /** True once the operator asked the run to stop. */
    aborted(): boolean;
    /**
     * `--one-off` runs: copy the flows into `.maestro/oneOff/<runId>/` and answer their ids. Called once, under the
     * host lock, before any adapter step (the iOS flows sync to the Mac in `prepareHost`). It throws when a one-off is
     * refused. Absent for a run of committed flows.
     */
    stageOneOffs?(): StagedOneOffs;
    readonly staggerMs: number;
    /** How long a stopped lane has to exit before it is killed. Defaults to {@link STOP_GRACE_MS}. */
    readonly stopGraceMs?: number;
    /** How long a killed lane has to be gone before the run stops waiting for it. Defaults to {@link KILL_WAIT_MS}. */
    readonly stopKillWaitMs?: number;
    log(line: string): void;
}

/** The exit code of a run the operator stopped. */
const ABORTED = 130;

interface PlatformPlan {
    readonly adapter: DeviceAdapter;
    readonly flows: readonly string[];
    readonly owed: readonly string[];
    readonly selector: string;
    readonly lanes: readonly LaneSpec[];
    /** The staged one-off ids this platform runs; empty for a run of committed flows. */
    readonly oneOffs: readonly string[];
}

const laneName = (lane: LaneSpec): string => `${lane.platform}-${lane.index}`;

/**
 * Plan one platform: its lanes, or none when it has nothing to run.
 *
 * @throws When no lane has its Clerk users (refused before anything starts).
 */
async function planPlatform(deps: LaneRunDeps, request: LaneRunRequest, platform: LanePlatform): Promise<PlatformPlan> {
    const adapter = deps.adapterFor(platform);
    const selection = selectionFor(request.selection, platform);

    if (selection !== 'all' && selection.length === 0) {
        deps.log(`nothing to run on ${platform}: no change touches a screen a flow covers`);

        return { adapter, flows: [], owed: [], selector: '', lanes: [], oneOffs: [] };
    }

    const oneOffs = request.oneOffs ?? [];
    const selector = selection === 'all' || oneOffs.length > 0 ? '' : flowSelector(selection);
    // A one-off has no row in the runner's registry, so the runner's selector would refuse it: they are the flows.
    const { flows, notes, owed } =
        oneOffs.length > 0 ? { flows: oneOffs, notes: [], owed: [] } : await deps.selectFlows(platform, selector);

    for (const note of notes) {
        deps.log(note);
    }

    if (flows.length === 0) {
        deps.log(`nothing to run on ${platform}: no selected flow is one these lanes can serve`);

        return { adapter, flows: [], owed, selector, lanes: [], oneOffs: [] };
    }

    const identityCap = await deps.identityCap(platform);

    if (identityCap === 0) {
        throw new Error(
            `maestro:lanes: no ${platform} lane has its Clerk users - the owner adds one with ` +
                `\`poolAdmin --apply --maestro-lane --platform ${platform} --shard 1\``,
        );
    }

    const plan = planLanes({
        ...(await adapter.hostFacts()),
        perLane: adapter.laneCost,
        identityCap,
        // A lane signs in once, so the Clerk cap is the identity cap.
        clerkCap: identityCap,
        work: flows.length,
        requested: Math.min(request.requested ?? adapter.maxLanes, adapter.maxLanes),
    });
    const count = await fitLaneCount(plan.count, (index, of) => deps.pack(platform, index, of, flows));
    deps.log(
        `${platform}: ${count} lane(s) for ${flows.length} flow(s) (planned ${plan.count}, bound by ${plan.boundBy}; ` +
            `caps ${JSON.stringify(plan.caps)})`,
    );

    return {
        adapter,
        flows,
        owed,
        selector,
        oneOffs,
        lanes: laneSpecs({ platform, count, stateDir: deps.stateDir, deviceFor: (index) => adapter.deviceFor(index) }),
    };
}

/**
 * Run the lanes.
 *
 * @sideEffect Everything the deps do: locks, services, devices, lane processes.
 * @returns 0 when every lane passed or there was nothing to run, {@link ABORTED} when stopped, else the worst lane code.
 * @throws When planning or setup fails; everything started is stopped first.
 */
export async function runLaneRun(deps: LaneRunDeps, request: LaneRunRequest): Promise<number> {
    const lock = deps.acquireLock();

    if (lock.reclaimedFrom !== undefined) {
        deps.log(
            `reclaimed the host lock from pid ${lock.reclaimedFrom}, which is gone (an earlier run that died or a restart)`,
        );
    }

    let staged: StagedOneOffs | undefined;

    try {
        staged = deps.stageOneOffs?.();
        const planned = staged === undefined ? request : { ...request, oneOffs: staged.ids };
        const plans: PlatformPlan[] = [];

        for (const platform of planned.platforms) {
            plans.push(await planPlatform(deps, planned, platform));
        }

        const lanes = plans.flatMap((plan) => plan.lanes);

        const code =
            lanes.length === 0
                ? 0
                : await runPlanned(
                      deps,
                      plans.filter((plan) => plan.lanes.length > 0),
                      lanes,
                  );

        // A platform with nothing to run passed nothing, which is not a failure: its stamp may still move.
        for (const plan of plans.filter(
            (candidate) => candidate.lanes.length === 0 && candidate.oneOffs.length === 0 && !deps.aborted(),
        )) {
            await deps.settleStamp({
                platform: plan.adapter.platform,
                flows: [],
                owed: plan.owed,
                results: new Map(),
                recorderClean: true,
            });
        }

        return code;
    } finally {
        staged?.remove();
        lock.release();
    }
}

async function runPlanned(
    deps: LaneRunDeps,
    plans: readonly PlatformPlan[],
    lanes: readonly LaneSpec[],
): Promise<number> {
    const planOf = new Map(plans.flatMap((plan) => plan.lanes.map((lane) => [lane, plan] as const)));

    const envOf = (lane: LaneSpec): Env => {
        const plan = planOf.get(lane);

        return laneRunnerEnv({
            base: deps.baseEnv,
            lane,
            selector: plan?.selector ?? '',
            lockDir: deps.lockDir,
            evidenceDir: failureEvidenceDir(lane.stateDir, deps.runStamp),
            adapterEnv: plan?.adapter.laneEnv(lane) ?? {},
            oneOffFlows: plan?.oneOffs ?? [],
        });
    };

    mkdirSync(deps.lockDir, { recursive: true });

    for (const lane of lanes) {
        mkdirSync(lane.stateDir, { recursive: true });
        pruneFailureRuns(lane.stateDir);
    }

    if (deps.aborted()) {
        return ABORTED;
    }

    const services = await deps.startServices();
    const platforms = plans.map((plan) => plan.adapter.platform);
    const started: LaneSpec[] = [];
    const prepared: DeviceAdapter[] = [];

    const runLanes = async (): Promise<number> => {
        await deps.createRunUsers(platforms);
        await services.resetLanes(lanes);

        for (const lane of lanes) {
            if (deps.aborted()) {
                return ABORTED;
            }

            await deps.setupLane(lane, envOf(lane));
        }

        // Every device of every platform boots at once: each has its own port and serial (or Simulator), so no boot
        // waits for another. Settled, not raced: a boot that fails must not leave the others mid-boot while the cleanup
        // runs.
        await settleAll(
            plans.map(async (plan) => {
                prepared.push(plan.adapter);
                await plan.adapter.prepareHost({
                    runId: path.basename(deps.stateDir),
                    stateDir: deps.stateDir,
                    repoRoot: deps.repoRoot,
                });
                await settleAll(
                    plan.lanes.map(async (lane) => {
                        if (deps.aborted()) {
                            return;
                        }

                        started.push(lane);
                        await plan.adapter.startDevice(lane);
                    }),
                );
            }),
        );

        // Asked once, now: a loss that happened already (a stale forward answered the probe, then the tunnel ended)
        // is still there to read. `setImmediate` settles only after every queued microtask has run, so a loss that is
        // already settled wins the race however many `then` or `async` layers wrap it.
        const losses = plans.map((plan) => plan.adapter.lost());
        const alreadyLost = await Promise.race([...losses, setImmediate()]);

        if (alreadyLost !== undefined) {
            throw alreadyLost;
        }

        const exits: Promise<number>[] = [];
        const children: LaneChild[] = [];
        // Work that must end as soon as a tunnel is lost: the stagger wait and the lanes themselves.
        const unlessLost = <T>(work: Promise<T>): Promise<T> =>
            Promise.race([
                work,
                ...losses.map((loss) =>
                    loss.then((error) => {
                        throw error;
                    }),
                ),
            ]);
        let codes: number[];

        try {
            for (const lane of lanes) {
                if (deps.aborted()) {
                    break;
                }

                if (exits.length > 0) {
                    let staggerOver: NodeJS.Timeout | undefined;

                    try {
                        await unlessLost(
                            new Promise<void>((resolve) => {
                                staggerOver = setTimeout(resolve, deps.staggerMs);
                            }),
                        );
                    } finally {
                        // A loss ends the wait early: the timer must not hold the process for the rest of it.
                        clearTimeout(staggerOver);
                    }
                }

                const startedAt = Date.now();
                const child = deps.spawnLane(lane, envOf(lane));
                children.push(child);
                deps.log(
                    `lane ${laneName(lane)}/${lane.count}: ${lane.device} started, log ${lane.stateDir}/runner.log`,
                );
                exits.push(
                    child.exit.then((code) => {
                        deps.log(
                            `lane ${laneName(lane)} exited ${code} after ` +
                                `${Math.round((Date.now() - startedAt) / 1000)} s`,
                        );

                        return code;
                    }),
                );
            }

            codes = await unlessLost(Promise.all(exits));
        } catch (error) {
            // The lanes would run against a dead forward. Stop them, kill any that ignore it, and let them exit before
            // the devices go. A lane is done when its runner has exited and its group is gone: bash may exit on SIGTERM
            // while a child of its group stays.
            const exited = new Set<number>();
            const targets = children.map((child, index) => ({
                stop: (signal: StopSignal) => {
                    child.stop(signal);
                },
                running: () => child.running() || !exited.has(index),
            }));

            for (const [index, exit] of exits.entries()) {
                void exit.then(
                    () => exited.add(index),
                    () => exited.add(index),
                );
            }

            const outcome = await stopTargets(targets, {
                graceMs: deps.stopGraceMs ?? STOP_GRACE_MS,
                killWaitMs: deps.stopKillWaitMs ?? KILL_WAIT_MS,
            });

            if (outcome === 'stuck') {
                deps.log('a lane was still running after SIGKILL; the devices are stopped anyway');
            }

            throw error;
        }

        if (deps.aborted()) {
            return ABORTED;
        }

        const checked = await deps.checkScreens(lanes);

        // A one-off is not part of the committed suite, so a run of one-offs earns the stamp nothing.
        for (const plan of plans.filter((candidate) => candidate.oneOffs.length === 0)) {
            const { platform } = plan.adapter;

            await deps.settleStamp({
                platform,
                flows: plan.flows,
                owed: plan.owed,
                results: checked.results.get(platform) ?? new Map(),
                recorderClean: checked.code === 0,
            });
        }

        return Math.max(...codes, checked.code);
    };

    // Every step runs whatever the one before it did. The services stop before the run users go (a lane's reset needs
    // them), and the users go before the devices, so an interrupted teardown leaves no Clerk user behind it.
    const tearDown = (): Promise<Error | undefined> =>
        firstFailure([
            () => services.stop(lanes),
            () => deps.removeRunUsers(platforms),
            ...started.map((lane) => async () => planOf.get(lane)?.adapter.stopDevice(lane)),
            ...prepared.map((adapter) => () => adapter.teardownHost()),
        ]);

    let code: number;

    try {
        code = await runLanes();
    } catch (error) {
        const cleanup = await tearDown();

        // The run's own failure is the one to report; a cleanup failure after it is logged, not swapped in.
        if (cleanup !== undefined) {
            deps.log(`the cleanup also failed: ${cleanup.message}`);
        }

        throw error;
    }

    const cleanup = await tearDown();

    // After a run that ended on its own, a cleanup failure IS the outcome: a Clerk user may still stand.
    if (cleanup !== undefined) {
        throw cleanup;
    }

    return code;
}

/**
 * Wait for every promise, then throw the first rejection.
 *
 * @throws The first rejection, once all have settled.
 */
async function settleAll(work: readonly Promise<void>[]): Promise<void> {
    const rejected = (await Promise.allSettled(work)).find((outcome) => outcome.status === 'rejected');

    if (rejected !== undefined) {
        throw rejected.reason;
    }
}

/**
 * Run every step in order, each whatever the one before it did.
 *
 * @returns The first failure, or `undefined`.
 */
async function firstFailure(steps: readonly (() => Promise<unknown>)[]): Promise<Error | undefined> {
    let first: Error | undefined;

    for (const step of steps) {
        try {
            await step();
        } catch (error) {
            first ??= error instanceof Error ? error : new Error(inspect(error));
        }
    }

    return first;
}
