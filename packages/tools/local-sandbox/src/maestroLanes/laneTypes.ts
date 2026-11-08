/**
 * The types the local Maestro lane orchestrator (`bin/maestroLanes.ts`) and its device adapters share.
 *
 * A LANE is one run-mode `runMaestroFlows.sh` process driving one device. Lane `k` of a platform is shard `k` of that
 * platform: it signs in as `maestroSlotForShard(role, platform, k)` and packs its own flows. The environment the
 * orchestrator and the adapter set on that process is the runner's lane contract, documented and tested where it is read
 * (`runMaestroFlows.sh`, `maestroLaneEnv.integration.test.ts`).
 *
 * @pattern Strategy — one {@link DeviceAdapter} per platform behind one port
 */
import type { LaneCost } from '@kitchensink/e2e-plan';
import type { Env } from '@kitchensink/e2e-plan/stampRun';

export type LanePlatform = 'android' | 'ios';

/** The processes and files an Android adapter and its hosts touch, injected so their decisions are testable without a device. */
export interface CommandPort {
    run(
        command: string,
        args: readonly string[],
        options?: { readonly env?: Env; readonly cwd?: string },
    ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr?: string }>;
    /** Start a long-lived process in its own process group, logging to `log`. */
    spawnDetached(command: string, args: readonly string[], log: string): { readonly pid: number };
    killGroup(pid: number): void;
    sleep(ms: number): Promise<void>;
    /** The file's text, or `undefined` when it does not exist. */
    readFile(file: string): string | undefined;
}

export interface LaneSpec {
    readonly platform: LanePlatform;
    /** 1-based. Equals `COMMISE_E2E_SHARD` and `MAESTRO_SHARD_INDEX`. */
    readonly index: number;
    /** `MAESTRO_SHARD_COUNT` for this platform. */
    readonly count: number;
    /**
     * The adapter's name for the lane's device, opaque to everything else: an emulator serial on Android, the
     * Simulator's NAME on iOS (its UDID exists only once `startDevice` has run, and reaches the runner through `laneEnv`).
     */
    readonly device: string;
    /** `7000 + index`, below the ephemeral range on both hosts. */
    readonly driverPort: number;
    /** `<state>/lanes/<platform>-<index>`. */
    readonly stateDir: string;
    /** The lane's fixture manifest, inside {@link LaneSpec.stateDir}. */
    readonly fixtureEnvFile: string;
}

/** What a host can spare, read when the run starts. */
export interface HostFacts {
    readonly cpus: number;
    /** One-minute load average: CPUs already busy with something else. */
    readonly load1: number;
    readonly memAvailable: number;
}

export interface RunContext {
    readonly runId: string;
    readonly stateDir: string;
    readonly repoRoot: string;
}

/** One per platform. The orchestrator calls these in this order. */
export interface DeviceAdapter {
    readonly platform: LanePlatform;
    /** What one lane costs the host, measured. */
    readonly laneCost: LaneCost;
    /** Android 8 (the serial table), iOS 5 (owner ruling). */
    readonly maxLanes: number;
    hostFacts(): Promise<HostFacts>;
    /** Build or verify the app, open tunnels, sync flows. */
    prepareHost(run: RunContext): Promise<void>;
    /** Pure: the name of the device lane `index` drives (see {@link LaneSpec.device}). */
    deviceFor(index: number): string;
    /** Boot, install, device settings. */
    startDevice(lane: LaneSpec): Promise<void>;
    /** The platform's part of the lane's run-mode environment. */
    laneEnv(lane: LaneSpec): Readonly<Record<string, string>>;
    stopDevice(lane: LaneSpec): Promise<void>;
    teardownHost(): Promise<void>;
}
