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
import { inspect } from 'node:util';

import { planLanes } from '@kitchensink/e2e-plan';

import type { HostLock } from './hostLock.js';
import { fitLaneCount, flowSelector, laneSpecs } from './lanePlanning.js';
import { laneRunnerEnv, type Env, type LaneChild } from './laneProcess.js';
import type { DeviceAdapter, LanePlatform, LaneSpec } from './laneTypes.js';
import type { SharedServices } from './sharedServices.js';

export interface LaneRunRequest {
    readonly platforms: readonly LanePlatform[];
    /** `--lanes`: it can only lower each platform's count. */
    readonly requested?: number;
    /** The impact selector's answer, or the flows named on the command line. */
    readonly selection: 'all' | readonly string[];
}

/** What the run needs from the world, injected so its order and its exits are testable without devices. */
export interface LaneRunDeps {
    adapterFor(platform: LanePlatform): DeviceAdapter;
    readonly stateDir: string;
    readonly repoRoot: string;
    readonly lockDir: string;
    readonly baseEnv: Env;
    acquireLock(): HostLock;
    /** The flows this platform's lanes run for a selector (the runner's own selection, platform and local filters). */
    selectFlows(
        platform: LanePlatform,
        selector: string,
    ): Promise<{ readonly flows: readonly string[]; readonly notes: readonly string[] }>;
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
     * After the lanes exit: checks the screens their flows showed against the registry. Answers 0 or a failing code,
     * which folds into the run's exit code.
     */
    checkScreens(lanes: readonly LaneSpec[]): Promise<number>;
    /** True once the operator asked the run to stop. */
    aborted(): boolean;
    readonly staggerMs: number;
    log(line: string): void;
}

/** The exit code of a run the operator stopped. */
export const ABORTED = 130;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface PlatformPlan {
    readonly adapter: DeviceAdapter;
    readonly selector: string;
    readonly lanes: readonly LaneSpec[];
}

const laneName = (lane: LaneSpec): string => `${lane.platform}-${lane.index}`;

/**
 * Plan one platform: its lanes, or none when it has nothing to run.
 *
 * @throws When no lane has its Clerk users (refused before anything starts).
 */
async function planPlatform(deps: LaneRunDeps, request: LaneRunRequest, platform: LanePlatform): Promise<PlatformPlan> {
    const adapter = deps.adapterFor(platform);
    const selector = request.selection === 'all' ? '' : flowSelector(request.selection);
    const { flows, notes } = await deps.selectFlows(platform, selector);

    for (const note of notes) {
        deps.log(note);
    }

    if (flows.length === 0) {
        deps.log(`nothing to run on ${platform}: no selected flow is one these lanes can serve`);

        return { adapter, selector, lanes: [] };
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
    const packed = new Map<string, readonly string[]>();

    for (let count = plan.count; count >= 1; count -= 1) {
        for (let index = 1; index <= count; index += 1) {
            packed.set(`${index}/${count}`, await deps.pack(platform, index, count, flows));
        }
    }

    const count = fitLaneCount(plan.count, (index, of) => packed.get(`${index}/${of}`) ?? []);
    deps.log(
        `${platform}: ${count} lane(s) for ${flows.length} flow(s) (planned ${plan.count}, bound by ${plan.boundBy}; ` +
            `caps ${JSON.stringify(plan.caps)})`,
    );

    return {
        adapter,
        selector,
        lanes: laneSpecs({ platform, count, stateDir: deps.stateDir, deviceFor: adapter.deviceFor }),
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

    try {
        const plans: PlatformPlan[] = [];

        for (const platform of request.platforms) {
            plans.push(await planPlatform(deps, request, platform));
        }

        const lanes = plans.flatMap((plan) => plan.lanes);

        if (lanes.length === 0) {
            return 0;
        }

        return await runPlanned(
            deps,
            plans.filter((plan) => plan.lanes.length > 0),
            lanes,
        );
    } finally {
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
            adapterEnv: plan?.adapter.laneEnv(lane) ?? {},
        });
    };

    mkdirSync(deps.lockDir, { recursive: true });

    for (const lane of lanes) {
        mkdirSync(lane.stateDir, { recursive: true });
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

        const exits: Promise<number>[] = [];

        for (const lane of lanes) {
            if (deps.aborted()) {
                break;
            }

            if (exits.length > 0) {
                await sleep(deps.staggerMs);
            }

            const startedAt = Date.now();
            const child = deps.spawnLane(lane, envOf(lane));
            deps.log(`lane ${laneName(lane)}/${lane.count}: ${lane.device} started, log ${lane.stateDir}/runner.log`);
            exits.push(
                child.exit.then((code) => {
                    deps.log(
                        `lane ${laneName(lane)} exited ${code} after ${Math.round((Date.now() - startedAt) / 1000)} s`,
                    );

                    return code;
                }),
            );
        }

        const codes = await Promise.all(exits);

        if (deps.aborted()) {
            return ABORTED;
        }

        return Math.max(...codes, await deps.checkScreens(lanes));
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
