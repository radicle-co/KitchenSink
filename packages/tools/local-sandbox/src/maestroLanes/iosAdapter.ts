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

import {
    IOS_MAX_LANES,
    laneSimulatorName,
    macHostFromEnv,
    parseHostFacts,
    sshConfigText,
    tunnelsFromManifest,
} from './iosLane.js';
import type { DeviceAdapter, HostFacts, LaneSpec, RunContext } from './laneTypes.js';

/** The I/O the adapter needs. A real one wraps `child_process` and `fs`; a test scripts it. */
export interface IosShell {
    /** Runs a command to completion and returns its stdout. Rejects on a non-zero exit. */
    run(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<string>;
    /** Starts a long-lived command (the tunnel). */
    background(command: string, args: readonly string[]): { stop(): Promise<void> };
    writeFile(file: string, content: string): Promise<void>;
    linkFile(target: string, link: string): Promise<void>;
}

export interface IosAdapterOptions {
    readonly shell: IosShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
}

const MAC_DIR = 'packages/tools/local-sandbox/bin/mac';

/**
 * Measured on the Mac (14 cpus) once the device runs have been done; until then a conservative guess that the planner
 * can only make smaller, never larger.
 */
const IOS_LANE_COST: LaneCost = { cpus: 3, memBytes: 6 * 1024 ** 3 };

export class IosAdapter implements DeviceAdapter {
    readonly platform = 'ios' as const;
    readonly laneCost = IOS_LANE_COST;
    readonly maxLanes = IOS_MAX_LANES;

    private readonly host: string;
    private readonly udids = new Map<number, string>();
    private tunnel: { stop(): Promise<void> } | undefined;
    private stateDir = '';
    private macHome = '';
    private contentKey = '';
    private runId = '';

    constructor(private readonly options: IosAdapterOptions) {
        this.host = macHostFromEnv(options.env);
    }

    private get sshConfig(): string {
        return path.join(this.stateDir, 'ssh.conf');
    }

    private get shimDir(): string {
        return path.join(this.stateDir, 'shims');
    }

    private ssh(command: string): Promise<string> {
        return this.options.shell.run('ssh', ['-F', this.sshConfig, this.host, command]);
    }

    private laneHost(...args: readonly string[]): Promise<string> {
        return this.ssh(['bash', 'ksIos/lane/laneHost.sh', ...args].join(' '));
    }

    deviceFor(index: number): string {
        return laneSimulatorName(index);
    }

    async hostFacts(): Promise<HostFacts> {
        // The planner asks before prepareHost, so there is no run ssh config yet: a plain one-off connection, with the
        // lane script put on the Mac first because it is the one place the facts are read.
        const { shell, repoRoot } = this.options;
        const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];
        await shell.run('ssh', [...options, this.host, 'mkdir -p ksIos/lane']);
        await shell.run('scp', [
            ...options,
            path.join(repoRoot, MAC_DIR, 'laneHost.sh'),
            `${this.host}:ksIos/lane/laneHost.sh`,
        ]);

        return parseHostFacts(await shell.run('ssh', [...options, this.host, 'bash ksIos/lane/laneHost.sh facts']));
    }

    async prepareHost(run: RunContext): Promise<void> {
        const { shell, repoRoot, env } = this.options;
        this.stateDir = run.stateDir;
        this.runId = run.runId;
        await shell.writeFile(
            this.sshConfig,
            sshConfigText({ host: this.host, controlPath: path.join(run.stateDir, 'cm-%C') }),
        );
        this.macHome = (await this.ssh('printenv HOME')).trim();

        // The app must be the one for THIS tree. buildIosApp.sh refuses (and says how to build it) when it is not.
        const buildEnv = {
            KS_MAC_HOST: this.host,
            KS_MAC_SSH_CONFIG: this.sshConfig,
            CLERK_PUBLISHABLE_KEY: env['CLERK_PUBLISHABLE_KEY'] ?? '',
        };
        const script = path.join(repoRoot, MAC_DIR, 'buildIosApp.sh');
        this.contentKey = (await shell.run('bash', [script, 'content-key'], buildEnv)).trim();
        await shell.run('bash', [script, 'check', this.contentKey], buildEnv);

        await this.ssh('mkdir -p ksIos/lane');
        await shell.run('scp', [
            '-F',
            this.sshConfig,
            path.join(repoRoot, MAC_DIR, 'laneHost.sh'),
            `${this.host}:ksIos/lane/laneHost.sh`,
        ]);
        await shell.run('rsync', [
            '-a',
            '--delete',
            '-e',
            `ssh -F ${this.sshConfig}`,
            `${path.join(repoRoot, 'packages/apps/commise/mobile/.maestro')}/`,
            `${this.host}:ksIos/run/${this.runId}/mobile/.maestro/`,
        ]);

        await shell.linkFile(path.join(repoRoot, MAC_DIR, 'maestroShim.sh'), path.join(this.shimDir, 'maestro'));
        await shell.linkFile(path.join(repoRoot, MAC_DIR, 'xcrunShim.sh'), path.join(this.shimDir, 'xcrun'));

        // The tunnel serves the origins the app was built with, read from its own manifest, never assumed.
        const manifest = await this.ssh(`cat ksIos/apps/${this.contentKey}/testApp.manifest`);
        const forwards = tunnelsFromManifest(manifest).flatMap((t) => [
            '-R',
            `${String(t.macPort)}:localhost:${String(t.localPort)}`,
        ]);
        this.tunnel = shell.background('ssh', [
            '-F',
            this.sshConfig,
            '-N',
            '-o',
            'ExitOnForwardFailure=yes',
            ...forwards,
            this.host,
        ]);
    }

    async startDevice(lane: LaneSpec): Promise<void> {
        const udid = (await this.laneHost('ensure', String(lane.index))).trim();
        this.udids.set(lane.index, udid);
        // A Simulator that kept a previous run's app data would start signed in: erase, then boot, then install.
        await this.laneHost('erase', udid);
        await this.laneHost('boot', udid);
        await this.laneHost('install', udid, `ksIos/apps/${this.contentKey}`);
        await this.ssh(`mkdir -p ksIos/lanes/lane${String(lane.index)}`);
    }

    laneEnv(lane: LaneSpec): Readonly<Record<string, string>> {
        const udid = this.udids.get(lane.index);

        if (udid === undefined) {
            throw new Error(`iOS lane ${String(lane.index)} has no Simulator yet; startDevice must run first`);
        }

        return {
            MAESTRO_IOS_UDID: udid,
            MAESTRO_SKIP_INSTALL: '1',
            PATH: `${this.shimDir}:${this.options.env['PATH'] ?? ''}`,
            KS_MAC_HOST: this.host,
            KS_MAC_SSH_CONFIG: this.sshConfig,
            KS_MAC_TREE: `${this.macHome}/ksIos/run/${this.runId}`,
            KS_MAC_LANE_HOME: `${this.macHome}/ksIos/lanes/lane${String(lane.index)}`,
            KS_MAC_JAVA_HOME: `${this.macHome}/ksIos/jdk17/Contents/Home`,
            KS_MAC_MAESTRO_BIN: `${this.macHome}/ksIos/maestro2110/bin/maestro`,
        };
    }

    async stopDevice(lane: LaneSpec): Promise<void> {
        const udid = this.udids.get(lane.index);

        if (udid !== undefined) {
            await this.ssh(`xcrun simctl shutdown ${udid}`);
        }
    }

    async teardownHost(): Promise<void> {
        await this.tunnel?.stop();
        this.tunnel = undefined;
    }
}
