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
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LaneCost } from '@kitchensink/e2e-plan';
import { quote } from 'shell-quote';

import {
    IOS_MAX_LANES,
    laneSimulatorName,
    macHostFromEnv,
    parseHostFacts,
    sshConfigText,
    tunnelsFromManifest,
} from './iosLane.js';
import type { DeviceAdapter, HostFacts, LaneSpec, RunContext } from './laneTypes.js';
import type { LocalSettings } from './localSettings.js';

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
    /** The local stack's origins, from `localMaestro.sh`'s settings: the host side of each tunnel. */
    readonly settings: Pick<LocalSettings, 'recipeOrigin' | 'identityOrigin' | 'foodOrigin'>;
    readonly shell: IosShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
}

/** What the Mac's shell may see in a path we build from a value: no space, quote or metacharacter. */
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/u;
const PLAIN_PATH = /^[A-Za-z0-9._/@%+=:,-]+$/u;
const HEX = /^[0-9a-f]+$/u;

/** One command line for the Mac's shell, every word quoted so a value reaches the command as exactly one argument. */
const remote = (...words: readonly string[]): string => quote([...words]);

const MAC_DIR = 'packages/tools/local-sandbox/bin/mac';
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
        return this.ssh(remote('bash', 'ksIos/lane/laneHost.sh', ...args));
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

        if (!PLAIN_NAME.test(run.runId)) {
            throw new Error(
                `the run id ${JSON.stringify(run.runId)} is not a plain name; it becomes a folder on the Mac`,
            );
        }

        this.stateDir = run.stateDir;
        this.runId = run.runId;

        // rsync splits its own -e string and does not read shell quoting, so the ssh config path must need none.
        if (!PLAIN_PATH.test(this.sshConfig)) {
            throw new Error(`the ssh config path ${JSON.stringify(this.sshConfig)} holds characters rsync would split`);
        }

        await shell.writeFile(
            this.sshConfig,
            sshConfigText({ host: this.host, controlPath: path.join(tmpdir(), 'ksIosCm-%C') }),
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

        if (!HEX.test(this.contentKey)) {
            throw new Error(`the content key ${JSON.stringify(this.contentKey)} is not lowercase hex`);
        }

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
        const manifest = await this.ssh(remote('cat', `ksIos/apps/${this.contentKey}/testApp.manifest`));
        const forwards = tunnelsFromManifest(manifest, this.options.settings).flatMap((t) => [
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
        await this.ssh(remote('mkdir', '-p', `ksIos/lanes/lane${String(lane.index)}`));
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
            await this.ssh(remote('xcrun', 'simctl', 'shutdown', udid));
        }
    }

    async teardownHost(): Promise<void> {
        await this.tunnel?.stop();
        this.tunnel = undefined;
    }
}
