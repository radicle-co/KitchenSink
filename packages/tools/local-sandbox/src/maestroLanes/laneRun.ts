/**
 * One local Maestro lane run, from the host lock to the worst lane's exit code.
 *
 * The order is the contract (`maestroLanesBlueprint.md` §1 and §3): take the host lock; select and plan, so a run over
 * no flows or no lane users starts nothing; start the shared services; reset and set up each lane ONE AT A TIME; prepare
 * the host and boot the devices; start the lanes staggered (Clerk limits sign-ins per IP, and each lane signs in once);
 * wait for all of them; reset every lane again while the services are up; then stop the services, the devices and the
 * lock, in that order, whatever failed on the way.
 *
 * @pattern Facade — one call over the lock, the planner, the Supervisor, the device Strategy and the lane processes
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { planLanes } from '@kitchensink/e2e-plan';

import type { HostLock } from './hostLock.js';
import { fitLaneCount, flowSelector, laneSpecs } from './lanePlanning.js';
import { laneRunnerEnv, type Env, type LaneChild } from './laneProcess.js';
import type { DeviceAdapter, LanePlatform, LaneSpec } from './laneTypes.js';
import type { SharedServices } from './sharedServices.js';

export interface LaneRunRequest {
    readonly platform: LanePlatform;
    /** `--lanes`: it can only lower the count. */
    readonly requested?: number;
    /** The impact selector's answer, or the flows named on the command line. */
    readonly selection: 'all' | readonly string[];
}

/** What the run needs from the world, injected so its order and its exits are testable without devices. */
export interface LaneRunDeps {
    readonly adapter: DeviceAdapter;
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
    /** The runner's packer: lane `index` of `count`'s flows. */
    pack(index: number, count: number, flows: readonly string[]): Promise<readonly string[]>;
    /** How many lanes, from lane 1, have their Clerk users. */
    identityCap(platform: LanePlatform): Promise<number>;
    startServices(): Promise<SharedServices>;
    /** After the lane's pool reset: align its identities and provision its world into its manifest. */
    setupLane(lane: LaneSpec, env: Env): Promise<void>;
    spawnLane(lane: LaneSpec, env: Env): LaneChild;
    readonly staggerMs: number;
    log(line: string): void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the lanes.
 *
 * @sideEffect Everything the deps do: locks, services, devices, lane processes.
 * @returns 0 when every lane passed or there was nothing to run, else the worst lane code (1 when no lane could run).
 * @throws When setup fails before the lanes start; everything started is stopped first.
 */
export async function runLaneRun(deps: LaneRunDeps, request: LaneRunRequest): Promise<number> {
    const lock = deps.acquireLock();

    try {
        return await runLocked(deps, request);
    } finally {
        lock.release();
    }
}

async function runLocked(deps: LaneRunDeps, request: LaneRunRequest): Promise<number> {
    const { adapter } = deps;
    const selector = request.selection === 'all' ? '' : flowSelector(request.selection);
    const { flows, notes } = await deps.selectFlows(request.platform, selector);

    for (const note of notes) {
        deps.log(note);
    }

    if (flows.length === 0) {
        deps.log(`nothing to run on ${request.platform}: no selected flow is one these lanes can serve`);

        return 0;
    }

    const identityCap = await deps.identityCap(request.platform);
    const facts = await adapter.hostFacts();
    const plan = planLanes({
        ...facts,
        perLane: adapter.laneCost,
        identityCap,
        // A lane signs in once, so the Clerk cap is the identity cap.
        clerkCap: identityCap,
        work: flows.length,
        requested: Math.min(request.requested ?? adapter.maxLanes, adapter.maxLanes),
    });

    if (identityCap === 0) {
        deps.log(
            `no ${request.platform} lane has its Clerk users - the owner adds one with ` +
                `\`poolAdmin --apply --maestro-lane --platform ${request.platform} --shard 1\``,
        );

        return 1;
    }

    const packed = new Map<string, readonly string[]>();

    for (let count = plan.count; count >= 1; count -= 1) {
        for (let index = 1; index <= count; index += 1) {
            packed.set(`${index}/${count}`, await deps.pack(index, count, flows));
        }
    }

    const count = fitLaneCount(plan.count, (index, of) => packed.get(`${index}/${of}`) ?? []);
    deps.log(
        `${request.platform}: ${count} lane(s) for ${flows.length} flow(s) (bound by ${plan.boundBy}; caps ${JSON.stringify(plan.caps)})`,
    );

    const lanes = laneSpecs({
        platform: request.platform,
        count,
        stateDir: deps.stateDir,
        deviceFor: adapter.deviceFor,
    });
    const envOf = (lane: LaneSpec): Env =>
        laneRunnerEnv({ base: deps.baseEnv, lane, selector, lockDir: deps.lockDir, adapterEnv: adapter.laneEnv(lane) });

    mkdirSync(deps.lockDir, { recursive: true });

    for (const lane of lanes) {
        mkdirSync(lane.stateDir, { recursive: true });
    }

    const services = await deps.startServices();
    const started: LaneSpec[] = [];

    try {
        await services.resetLanes(lanes);

        for (const lane of lanes) {
            await deps.setupLane(lane, envOf(lane));
        }

        await adapter.prepareHost({
            runId: path.basename(deps.stateDir),
            stateDir: deps.stateDir,
            repoRoot: deps.repoRoot,
        });

        for (const lane of lanes) {
            started.push(lane);
            await adapter.startDevice(lane);
        }

        const children: LaneChild[] = [];

        for (const lane of lanes) {
            if (children.length > 0) {
                await sleep(deps.staggerMs);
            }

            children.push(deps.spawnLane(lane, envOf(lane)));
            deps.log(`lane ${lane.index}/${lane.count}: ${lane.device}, log ${lane.stateDir}/runner.log`);
        }

        const codes = await Promise.all(children.map((child) => child.exit));
        deps.log(`lane exit codes: ${codes.join(' ')}`);

        return Math.max(...codes);
    } finally {
        try {
            await services.stop(lanes);
        } finally {
            for (const lane of started) {
                await adapter.stopDevice(lane);
            }

            await adapter.teardownHost();
        }
    }
}
