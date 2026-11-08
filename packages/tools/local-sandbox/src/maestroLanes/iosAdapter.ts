/**
 * The iOS side of the lane orchestrator: lanes are Simulators on a remote Mac, driven from this machine.
 *
 * Maestro, the runner and the stack all stay here. Only device commands cross to the Mac, through two PATH shims
 * (`bin/mac/maestroShim.sh`, `bin/mac/xcrunShim.sh`) over one ssh connection per run, and the three loopback origins the
 * app was built with are reached by one reverse tunnel.
 *
 * @pattern Strategy — the iOS implementation of the DeviceAdapter port.
 * @pattern Adapter — over ssh, rsync and `bin/mac/laneHost.sh`, behind the {@link IosShell} port so the logic is tested
 *   without a Mac.
 * @sideEffect Every method but {@link IosAdapter.deviceFor} and {@link IosAdapter.laneEnv} runs commands on the Mac.
 */
import path from 'node:path';

import type { LaneCost } from '@kitchensink/e2e-plan';

import { IOS_MAX_LANES, laneSimulatorName, tunnelsFromManifest } from './iosLane.js';
import type { DeviceAdapter, HostFacts, LaneSpec, RunContext } from './laneTypes.js';
import type { LocalSettings } from './localSettings.js';
import { MAC_DIR, MacSession, macPathsOf, remote, type MacShell } from './macSession.js';

/** The I/O the adapter needs: the Mac session's shell. */
export type IosShell = MacShell;

export interface IosAdapterOptions {
    /** The local stack's origins, from `localMaestro.sh`'s settings: the host side of each tunnel. */
    readonly settings: Pick<LocalSettings, 'recipeOrigin' | 'identityOrigin' | 'foodOrigin'>;
    readonly shell: IosShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
}

const HEX = /^[0-9a-f]+$/u;

const RUNNER = 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh';

/**
 * Measured with `maestro:macUsage` on a three-lane full run (2026-11-08, 49 minutes, one 14-cpu Mac): a lane's
 * Simulator, XCTest driver and Maestro JVM used 0.5 to 0.6 cpus on average with a one-cpu burst, and peaked at
 * 1.74 to 2.05 GiB resident. The cpu figure is the burst rounded up; the memory is the largest peak rounded up to
 * 2.1 GiB. It counts only a lane's own processes, not the shared Simulator services, which is what the planner's
 * safety margin on free memory is for.
 */
const IOS_LANE_COST: LaneCost = { cpus: 1, memBytes: Math.round(2.1 * 1024 ** 3) };

export class IosAdapter implements DeviceAdapter {
    readonly platform = 'ios' as const;
    readonly laneCost = IOS_LANE_COST;
    readonly maxLanes = IOS_MAX_LANES;

    private readonly session: MacSession;
    private readonly udids = new Map<number, string>();
    private contentKey = '';

    constructor(private readonly options: IosAdapterOptions) {
        this.session = new MacSession(options);
    }

    deviceFor(index: number): string {
        return laneSimulatorName(index);
    }

    hostFacts(): Promise<HostFacts> {
        return this.session.facts();
    }

    async prepareHost(run: RunContext): Promise<void> {
        const { shell, repoRoot, env } = this.options;
        await this.session.open(run);

        // The app must be the one for THIS tree. buildIosApp.sh refuses (and says how to build it) when it is not.
        const buildEnv = {
            KS_MAC_HOST: this.session.host,
            KS_MAC_SSH_CONFIG: this.session.sshConfig,
            CLERK_PUBLISHABLE_KEY: env['CLERK_PUBLISHABLE_KEY'] ?? '',
        };
        const script = path.join(repoRoot, MAC_DIR, 'buildIosApp.sh');
        this.contentKey = (await shell.run('bash', [script, 'content-key'], buildEnv)).trim();

        if (!HEX.test(this.contentKey)) {
            throw new Error(`the content key ${JSON.stringify(this.contentKey)} is not lowercase hex`);
        }

        await shell.run('bash', [script, 'check', this.contentKey, macPathsOf().iosApp(this.contentKey)], buildEnv);
        await this.session.syncFlows();
        await this.session.linkShim('maestro', 'maestroShim.sh');
        await this.session.linkShim('xcrun', 'xcrunShim.sh');

        // The tunnel serves the origins the app was built with, read from its own manifest, never assumed.
        const manifest = await this.session.ssh(
            remote('cat', `${macPathsOf().iosApp(this.contentKey)}/testApp.manifest`),
        );
        this.session.openTunnel(tunnelsFromManifest(manifest, this.options.settings));
    }

    async startDevice(lane: LaneSpec): Promise<void> {
        const udid = (await this.session.laneHost('ensure', String(lane.index))).trim();
        this.udids.set(lane.index, udid);
        // A Simulator that kept a previous run's app data would start signed in: erase, then boot, then install.
        await this.session.laneHost('erase', udid);
        await this.session.laneHost('boot', udid);
        await this.session.laneHost('install', udid, macPathsOf().iosApp(this.contentKey));

        // The runner holds the one copy of this step (held equal to CI's by a guard) but calls it only from its callers,
        // so the adapter sources the runner and runs it through the shims, which put it on this lane's Mac Simulator.
        await this.options.shell.run(
            'bash',
            [
                '-c',
                '. "$1" && maestro_disable_password_autofill_ios',
                'iosAdapter',
                path.join(this.options.repoRoot, RUNNER),
            ],
            this.laneEnv(lane),
        );
        await this.session.ssh(remote('mkdir', '-p', macPathsOf().laneHome(lane.index)));
    }

    laneEnv(lane: LaneSpec): Readonly<Record<string, string>> {
        const udid = this.udids.get(lane.index);

        // The orchestrator asks while it provisions the lane's users, before any Simulator exists. The runner refuses
        // an iOS run without MAESTRO_IOS_UDID, so an early answer cannot be driven by mistake.
        if (udid === undefined) {
            return {};
        }

        return {
            MAESTRO_IOS_UDID: udid,
            MAESTRO_SKIP_INSTALL: '1',
            ...this.session.shimEnv(lane.index),
        };
    }

    async stopDevice(lane: LaneSpec): Promise<void> {
        const udid = this.udids.get(lane.index);

        if (udid !== undefined) {
            await this.session.ssh(remote('xcrun', 'simctl', 'shutdown', udid));
        }
    }

    async teardownHost(): Promise<void> {
        await this.session.close();
    }
}
