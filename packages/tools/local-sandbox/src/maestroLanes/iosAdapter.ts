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
import { laneCosts } from '@kitchensink/e2e-plan/laneCosts';

import { IOS_MAX_LANES, laneSimulatorName, tunnelsFromManifest, type IosDevice } from './iosLane.js';
import type { DeviceAdapter, HostFacts, LaneSpec, RunContext } from './laneTypes.js';
import type { HostPorts } from './stackFacts.js';
import { MAC_DIR, MacSession, macPathsOf, remote, type MacShell } from './macSession.js';

/** The I/O the adapter needs: the Mac session's shell. */
export type IosShell = MacShell;

export interface IosAdapterOptions {
    /** The host port each service publishes, from the running stack: the local side of each tunnel. */
    readonly hostPorts: HostPorts;
    readonly shell: IosShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
    /** The class of every lane of this run: it picks the Simulator name, the cost and the device type on the Mac. */
    readonly device: IosDevice;
}

const HEX = /^[0-9a-f]+$/u;

const RUNNER = 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh';

const IOS_LANE_COSTS: Readonly<Record<IosDevice, LaneCost>> = { iphone: laneCosts.iphone, ipad: laneCosts.ipad };

export class IosAdapter implements DeviceAdapter {
    readonly platform = 'ios' as const;
    readonly laneCost: LaneCost;
    readonly maxLanes = IOS_MAX_LANES;

    private readonly session: MacSession;
    private readonly udids = new Map<number, string>();
    private contentKey = '';

    constructor(private readonly options: IosAdapterOptions) {
        this.session = new MacSession(options);
        this.laneCost = IOS_LANE_COSTS[options.device];
    }

    deviceFor(index: number): string {
        return laneSimulatorName(index, this.options.device);
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
        this.session.openTunnel(tunnelsFromManifest(manifest, this.options.hostPorts));
    }

    async startDevice(lane: LaneSpec): Promise<void> {
        const udid = (await this.session.laneHost('ensure', String(lane.index), this.options.device)).trim();
        this.udids.set(lane.index, udid);
        // A Simulator that kept a previous run's app data would start signed in: erase, then boot, then install.
        await this.session.laneHost('erase', udid);
        await this.session.laneHost('boot', udid);
        await this.session.laneHost('install', udid, macPathsOf().iosApp(this.contentKey));

        // The runner holds the one copy of these two steps but calls them only from its callers, so the adapter sources
        // the runner and runs them through the shims, which put them on this lane's Mac Simulator. AutoFill is held equal
        // to CI's copy by `maestroPasswordAutofill.test.ts`. The banner switch is lane-only: CI has no copy of it yet.
        await this.options.shell.run(
            'bash',
            [
                '-c',
                '. "$1" && maestro_disable_password_autofill_ios && maestro_disable_apple_intelligence_banner_ios',
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
