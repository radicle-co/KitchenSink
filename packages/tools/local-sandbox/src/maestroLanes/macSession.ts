/**
 * One run's session with the Mac that hosts device lanes: the ssh config, the Mac's HOME, the lane scripts copied over, the
 * flows synced, and the one reverse tunnel. The iOS adapter and the Mac Android host both open one, so each of those facts has
 * one home (ADR-0088 §5). It holds no device logic.
 *
 * @pattern Facade over ssh, scp and rsync, behind the {@link MacShell} port so it is tested without a Mac.
 * @sideEffect Every method but the getters runs commands on the Mac or writes the run's ssh config.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';

import { quote } from 'shell-quote';

import { macHostFromEnv, parseHostFacts, sshConfigText, type MacHostFacts, type Tunnel } from './iosLane.js';
import type { RunContext } from './laneTypes.js';

/** The I/O a session needs. A real one wraps `child_process` and `fs`; a test scripts it. */
export interface MacShell {
    /** Runs a command to completion and returns its stdout. Rejects on a non-zero exit. */
    run(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<string>;
    /** Starts a long-lived command (the tunnel). */
    background(command: string, args: readonly string[]): { stop(): Promise<void> };
    writeFile(file: string, content: string): Promise<void>;
    linkFile(target: string, link: string): Promise<void>;
}

export interface MacSessionOptions {
    readonly shell: MacShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
}

/** What the Mac's shell may see in a path we build from a value: no space, quote or metacharacter. */
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/u;
const PLAIN_PATH = /^[A-Za-z0-9._/@%+=:,-]+$/u;

/** One command line for the Mac's shell, every word quoted so a value reaches the command as exactly one argument. */
export const remote = (...words: readonly string[]): string => quote([...words]);

export const MAC_DIR = 'packages/tools/local-sandbox/bin/mac';

/**
 * Every folder the lanes use on the Mac, built in this one place (`macSession.test.ts` holds that no other lane file writes a
 * Mac folder name). With the Mac's HOME the paths are absolute; without it they are relative to HOME, for a command that
 * runs there.
 */
export function macPathsOf(home?: string) {
    const at = (relative: string): string => (home === undefined ? relative : `${home}/${relative}`);

    return {
        laneFolder: at('ksIos/lane'),
        laneHostScript: at('ksIos/lane/laneHost.sh'),
        androidLaneHostScript: at('ksIos/lane/androidLaneHost.sh'),
        laneHome: (index: number): string => at(`ksIos/lanes/lane${String(index)}`),
        runTree: (runId: string): string => at(`ksIos/run/${runId}`),
        iosApp: (key: string): string => at(`ksIos/apps/${key}`),
        androidApp: (key: string): string => at(`ksIos/apps/android/${key}`),
        androidEnv: at('ksAndroid/env.sh'),
        androidSdk: at('ksAndroid/sdk'),
        jdk: at('ksIos/jdk17/Contents/Home'),
        maestroBin: at('ksIos/maestro2110/bin/maestro'),
    };
}

export type MacPaths = ReturnType<typeof macPathsOf>;

export class MacSession {
    readonly host: string;
    private tunnel: { stop(): Promise<void> } | undefined;
    private stateDirectory = '';
    private home = '';
    private run = '';

    constructor(private readonly options: MacSessionOptions) {
        this.host = macHostFromEnv(options.env);
    }

    get sshConfig(): string {
        return path.join(this.stateDirectory, 'ssh.conf');
    }

    get shimDir(): string {
        return path.join(this.stateDirectory, 'shims');
    }

    get macHome(): string {
        return this.home;
    }

    /** The Mac's folders, absolute: valid once {@link MacSession.open} has read the Mac's HOME. */
    get paths(): MacPaths {
        return macPathsOf(this.home);
    }

    get runId(): string {
        return this.run;
    }

    ssh(command: string): Promise<string> {
        return this.options.shell.run('ssh', ['-F', this.sshConfig, this.host, command]);
    }

    /** Runs `ksIos/lane/laneHost.sh` (the iOS lane script) with every word quoted. */
    laneHost(...args: readonly string[]): Promise<string> {
        return this.ssh(remote('bash', macPathsOf().laneHostScript, ...args));
    }

    /** Runs `ksIos/lane/androidLaneHost.sh` with every word quoted, told where the Mac's Android environment file is. */
    androidLaneHost(...args: readonly string[]): Promise<string> {
        return this.ssh(
            remote(
                'env',
                `KS_ANDROID_ENV=${this.paths.androidEnv}`,
                'bash',
                macPathsOf().androidLaneHostScript,
                ...args,
            ),
        );
    }

    /**
     * The Mac's host facts. The planner asks before {@link MacSession.open}, so there is no run ssh config yet: a plain one-off
     * connection, with the lane script put on the Mac first because it is the one place the facts are read.
     */
    async facts(): Promise<MacHostFacts> {
        const { shell, repoRoot } = this.options;
        const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];
        await shell.run('ssh', [...options, this.host, remote('mkdir', '-p', macPathsOf().laneFolder)]);
        await shell.run('scp', [
            ...options,
            path.join(repoRoot, MAC_DIR, 'laneHost.sh'),
            `${this.host}:${macPathsOf().laneHostScript}`,
        ]);

        return parseHostFacts(
            await shell.run('ssh', [...options, this.host, remote('bash', macPathsOf().laneHostScript, 'facts')]),
        );
    }

    /** Opens the session: the ssh config, the Mac's HOME, and both lane scripts on the Mac. */
    async open(run: RunContext): Promise<void> {
        const { shell, repoRoot } = this.options;

        if (!PLAIN_NAME.test(run.runId)) {
            throw new Error(
                `the run id ${JSON.stringify(run.runId)} is not a plain name; it becomes a folder on the Mac`,
            );
        }

        this.stateDirectory = run.stateDir;
        this.run = run.runId;

        // rsync splits its own -e string and does not read shell quoting, so the ssh config path must need none.
        if (!PLAIN_PATH.test(this.sshConfig)) {
            throw new Error(`the ssh config path ${JSON.stringify(this.sshConfig)} holds characters rsync would split`);
        }

        await shell.writeFile(
            this.sshConfig,
            sshConfigText({ host: this.host, controlPath: path.join(tmpdir(), 'ksIosCm-%C') }),
        );
        this.home = (await this.ssh('printenv HOME')).trim();
        await this.ssh(remote('mkdir', '-p', macPathsOf().laneFolder));

        for (const script of ['laneHost.sh', 'androidLaneHost.sh']) {
            await shell.run('scp', [
                '-F',
                this.sshConfig,
                path.join(repoRoot, MAC_DIR, script),
                `${this.host}:${macPathsOf().laneFolder}/${script}`,
            ]);
        }
    }

    /**
     * What the runner's Maestro shim needs for lane `index`: the shims first on PATH, the Mac, and the lane's own Maestro HOME
     * (lanes must not share one: Maestro keeps its driver state there).
     */
    shimEnv(index: number): Record<string, string> {
        const { paths } = this;

        return {
            PATH: `${this.shimDir}:${this.options.env['PATH'] ?? ''}`,
            KS_MAC_HOST: this.host,
            KS_MAC_SSH_CONFIG: this.sshConfig,
            KS_MAC_TREE: paths.runTree(this.run),
            KS_MAC_LANE_HOME: paths.laneHome(index),
            KS_MAC_JAVA_HOME: paths.jdk,
            KS_MAC_MAESTRO_BIN: paths.maestroBin,
        };
    }

    /** Syncs this tree's Maestro flows to the run's folder on the Mac. */
    async syncFlows(): Promise<void> {
        const { shell, repoRoot } = this.options;
        await shell.run('rsync', [
            '-a',
            '--delete',
            '-e',
            `ssh -F ${this.sshConfig}`,
            `${path.join(repoRoot, 'packages/apps/commise/mobile/.maestro')}/`,
            `${this.host}:${macPathsOf().runTree(this.run)}/mobile/.maestro/`,
        ]);
    }

    /** Puts a committed shim script on this run's PATH folder under `name`. */
    linkShim(name: string, script: string): Promise<void> {
        return this.options.shell.linkFile(
            path.join(this.options.repoRoot, MAC_DIR, script),
            path.join(this.shimDir, name),
        );
    }

    /** One reverse tunnel carrying each Mac port back to its port on this machine. */
    openTunnel(forwards: readonly Tunnel[]): void {
        this.tunnel = this.options.shell.background('ssh', [
            '-F',
            this.sshConfig,
            '-N',
            '-o',
            'ExitOnForwardFailure=yes',
            ...forwards.flatMap((t) => ['-R', `${String(t.macPort)}:localhost:${String(t.localPort)}`]),
            this.host,
        ]);
    }

    async close(): Promise<void> {
        await this.tunnel?.stop();
        this.tunnel = undefined;
    }
}
