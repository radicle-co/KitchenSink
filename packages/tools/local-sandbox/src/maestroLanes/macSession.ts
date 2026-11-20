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
import { setTimeout as delay } from 'node:timers/promises';

import { quote } from 'shell-quote';

import { macHostFromEnv, parseHostFacts, sshConfigText, type MacHostFacts, type Tunnel } from './iosLane.js';
import { NEVER_LOST, type RunContext } from './laneTypes.js';

/** The I/O a session needs. A real one wraps `child_process` and `fs`; a test scripts it. */
export interface MacShell {
    /** Runs a command to completion and returns its stdout. Rejects on a non-zero exit. */
    run(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<string>;
    /**
     * Starts a long-lived command (the tunnel). `exited` resolves with the command's exit code (a signal is `128 + n`)
     * and never rejects.
     */
    background(command: string, args: readonly string[]): { stop(): Promise<void>; readonly exited: Promise<number> };
    writeFile(file: string, content: string): Promise<void>;
    linkFile(target: string, link: string): Promise<void>;
}

export interface MacSessionOptions {
    readonly shell: MacShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
    /** Waits `ms`. Injected so a test counts the wait and does not spend it. */
    readonly sleep?: (ms: number) => Promise<void>;
    /** The time in ms. Injected, with `sleep`, so a test moves the clock and the probe deadline is real wall time. */
    readonly now?: () => number;
}

/**
 * The health probe asks again every `PROBE_INTERVAL_MS` while a port is silent. All ports together get
 * `PROBE_DEADLINE_MS` of wall time from the moment the tunnel starts.
 */
const PROBE_INTERVAL_MS = 500;
const PROBE_DEADLINE_MS = 10_000;

const healthUrl = (forward: Tunnel): string => `http://127.0.0.1:${String(forward.macPort)}/health`;

/** What one opening of the tunnel shares across its ports: whether it is over, and the wall time it must end by. */
interface Probing {
    over: boolean;
    readonly until: number;
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
    private closing = false;
    private loss: Promise<Error> = NEVER_LOST;
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
        if (this.home === '') {
            throw new Error('the Mac folders are asked for before the session was opened (open() reads the Mac HOME)');
        }

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

    /**
     * One reverse tunnel carrying each Mac port back to its port on this machine, then a check that each port serves.
     *
     * The tunnel owns its ssh connection (S81). Through the shared master its forwards would outlive the run, and the
     * next run's tunnel would exit with no message while the run used the dead forward.
     *
     * @throws When the tunnel exits before the check ends, when a port answers `/health` with anything but 200 before
     * the deadline, or when the reply is not an HTTP code.
     */
    async openTunnel(forwards: readonly Tunnel[]): Promise<void> {
        const tunnel = this.options.shell.background('ssh', [
            '-F',
            this.sshConfig,
            '-N',
            '-o',
            'ControlMaster=no',
            '-o',
            'ControlPath=none',
            '-o',
            'ExitOnForwardFailure=yes',
            ...forwards.flatMap((t) => ['-R', `${String(t.macPort)}:localhost:${String(t.localPort)}`]),
            this.host,
        ]);
        this.tunnel = tunnel;
        this.closing = false;
        // Made now, so a loss before anyone asks is still there to read. An exit that close() causes is not a loss.
        this.loss = tunnel.exited.then((code) => (this.closing ? NEVER_LOST : this.exitError(code, 'during the run')));
        const early = tunnel.exited.then((code) => this.exitError(code, 'before the run used it'));
        const probing = { over: false, until: (this.options.now ?? Date.now)() + PROBE_DEADLINE_MS };

        try {
            const failure = await Promise.race([this.probeAll(forwards, probing), early]);

            if (failure !== undefined) {
                throw failure;
            }
        } finally {
            probing.over = true;
        }
    }

    /**
     * Resolves with the reason when the tunnel exits while it is open.
     * It stays pending after {@link MacSession.close}.
     */
    lost(): Promise<Error> {
        return this.loss;
    }

    private exitError(code: number, when: string): Error {
        return new Error(`the tunnel ssh exited with code ${String(code)} ${when}`);
    }

    /** Asks each forwarded port in turn. Resolves with nothing when every port serves, and with the error otherwise. */
    private async probeAll(forwards: readonly Tunnel[], probing: Probing): Promise<Error | undefined> {
        for (const forward of forwards) {
            const failure = await this.probe(forward, probing);

            if (failure !== undefined) {
                return failure;
            }
        }

        return undefined;
    }

    /**
     * Asks one Mac port for `/health`. Code 000 means nothing answers yet (the forward comes up a moment after ssh
     * starts), so it is asked again until the deadline. Any other code that is not 200 fails at once. A reply that is
     * not a code (curl missing on the Mac) fails at once and is quoted, never read as 000.
     */
    private async probe(forward: Tunnel, probing: Probing): Promise<Error | undefined> {
        const { sleep = (ms: number) => delay(ms) } = this.options;
        const now = this.options.now ?? Date.now;
        const where = `the Mac port ${String(forward.macPort)}`;

        while (!probing.over) {
            // curl exits non-zero when nothing answers but still prints 000, so its status is ignored and its
            // output is read.
            const reply = (
                await this.ssh(
                    remote(
                        'sh',
                        '-c',
                        // The port is a number from the manifest, so it can sit in the script text.
                        `curl -s -o /dev/null -w %{http_code} --max-time 2 ${healthUrl(forward)} || true`,
                    ),
                )
            ).trim();

            if (!/^\d{3}$/u.test(reply)) {
                return new Error(`${where} probe answered ${JSON.stringify(reply)}, which is not an HTTP code`);
            }

            if (reply === '200') {
                return undefined;
            }

            if (reply !== '000' || now() >= probing.until) {
                return new Error(
                    `${where} answered /health with ${reply}, ` +
                        `so the forward to local port ${String(forward.localPort)} is not serving`,
                );
            }

            await sleep(PROBE_INTERVAL_MS);
        }

        return undefined;
    }

    async close(): Promise<void> {
        this.closing = true;
        await this.tunnel?.stop();
        this.tunnel = undefined;
    }
}
