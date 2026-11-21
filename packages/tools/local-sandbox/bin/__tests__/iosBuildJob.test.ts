/**
 * The Mac-side iOS build job, `bin/mac/iosBuildJob.sh` (CL-MACLOCK, staff S91): one build at a time on the Mac, each
 * from its own uploaded snapshot, under a kernel `flock` the job holds.
 *
 * These cases run the REAL script with real `bash`, `perl`, `rsync` and `tar` in a temp HOME. Only the build itself is
 * stood in for: the snapshot holds a stub `buildTestApp.sh`, and a stub `npm` and `npx` sit on PATH. The stub records
 * `start <key>` and `end <key>` and blocks on a release marker file, so every case synchronizes on files and the job's
 * `state` file, never on a sleep.
 *
 * What only real processes can prove, and a mock of the lock cannot: that two jobs never build at once, that a leftover
 * daemon cannot keep the lock after its job ended, and that a signal ends the whole build group before the next job
 * takes the lock. Each case names the mutation it is meant to kill.
 *
 * Gap for the follow-up PR (staff S91, PR 2): the prune, the stale-holder check, the build and wait limits and the perl
 * error split (tests 6 to 9 of the blueprint) are not here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    openSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { stopProcessesUnder } from './__fixtures__/processesUnder.js';

const JOB_SCRIPT = fileURLToPath(new URL('../mac/iosBuildJob.sh', import.meta.url));
const SYSTEM_PATH = '/usr/bin:/bin';
/** Absolute, so the test never resolves a command through a PATH it does not control. */
const BASH = '/bin/bash';

// Every case starts real processes and waits on files, up to `WAIT_MS`; a loaded runner needs more than vitest's 5 s.
vi.setConfig({ testTimeout: 30_000 });
const WAIT_MS = 15_000;
const BUILD_STUB = 'packages/apps/commise/mobile/scripts/buildTestApp.sh';

/** What the stub build does for one key, written to `mode.<key>`. */
type StubMode = 'block' | 'fail3' | 'fail75' | 'leaveGroup' | 'leaveSession' | 'leaveDeaf';

interface World {
    readonly root: string;
    readonly home: string;
    /** The stub's marker folder: `start.<key>`, `release.<key>`, `pid.<key>`, `events.log`. */
    readonly stub: string;
    readonly bin: string;
}

interface Job {
    readonly child: ChildProcess;
    /** The job's pid and its group id: it was spawned detached. Never 0, so a signal can never reach the runner's group. */
    readonly pid: number;
    readonly exit: Promise<number | null>;
}

const worlds: World[] = [];
const jobs: ChildProcess[] = [];

/** The build stub: records what the build saw, then behaves as its mode says. It runs from the shared build tree. */
const BUILD_STUB_BODY = `#!/usr/bin/env bash
k="$TEST_APP_CONTENT_KEY"
echo "start $k" >> "$STUB_DIR/events.log"
echo $$ > "$STUB_DIR/pid.$k"
[ -f f ] && cp f "$STUB_DIR/seen.f.$k"
touch "$STUB_DIR/start.$k"
mode="$(cat "$STUB_DIR/mode.$k" 2>/dev/null || echo block)"
case "$mode" in
    fail3) echo "end $k" >> "$STUB_DIR/events.log"; exit 3 ;;
    fail75) echo "end $k" >> "$STUB_DIR/events.log"; exit 75 ;;
    leaveSession) setsid sleep 300 > /dev/null 2>&1 & echo $! > "$STUB_DIR/pid.sleep.$k"; sleep 0.2 ;;
    leaveDeaf) bash -c 'trap "" TERM; exec sleep 300' > /dev/null 2>&1 & echo $! > "$STUB_DIR/pid.sleep.$k"; sleep 0.2 ;;
    leaveGroup) sleep 300 > /dev/null 2>&1 & echo $! > "$STUB_DIR/pid.sleep.$k"; sleep 0.2 ;;
    *) while [ ! -f "$STUB_DIR/release.$k" ]; do sleep 0.05; done ;;
esac
mkdir -p "$STUB_DIR/stage.$k" packages/apps/commise/mobile/dist-testApp/ios
cp marker "$STUB_DIR/stage.$k/marker" 2> /dev/null || true
tar -czf packages/apps/commise/mobile/dist-testApp/ios/app.tar.gz -C "$STUB_DIR/stage.$k" .
echo "key=$k" > packages/apps/commise/mobile/dist-testApp/ios/testApp.manifest
echo "end $k" >> "$STUB_DIR/events.log"
`;

/**
 * A temp HOME standing for the Mac's, a marker folder for the stub, and stub `npm` and `npx` on PATH.
 *
 * @sideEffect Creates files under the OS temp directory; `afterEach` removes them.
 */
function makeWorld(): World {
    const root = mkdtempSync(path.join(tmpdir(), 'iosBuildJob-'));
    const home = path.join(root, 'home');
    const stub = path.join(root, 'stub');
    const bin = path.join(root, 'bin');

    for (const folder of [home, stub, bin]) {
        mkdirSync(folder);
    }

    for (const tool of ['npm', 'npx']) {
        const file = path.join(bin, tool);

        writeFileSync(
            file,
            `#!/usr/bin/env bash\necho "${tool} $* registry=$npm_config_registry" >> "$STUB_DIR/tools.log"\n[ "${tool} $1" = "npm ci" ] && mkdir -p node_modules\nexit 0\n`,
        );
        chmodSync(file, 0o755);
    }

    const world = { root, home, stub, bin };

    worlds.push(world);

    return world;
}

const buildRoot = (world: World): string => path.join(world.home, 'ksIos', 'build.noindex');
const jobFolder = (world: World, job: string): string => path.join(buildRoot(world), 'jobs', job);

/**
 * Uploads a snapshot the way the client does: `jobs/<job>/src/` holding the stub build and the given files.
 *
 * @sideEffect Writes under the world's HOME.
 */
function upload(
    world: World,
    job: string,
    key: string,
    files: Record<string, string> = {},
    mode: StubMode = 'block',
): void {
    const src = path.join(jobFolder(world, job), 'src');
    const all: Record<string, string> = { 'package-lock.json': '{}', [BUILD_STUB]: BUILD_STUB_BODY, ...files };

    for (const [name, body] of Object.entries(all)) {
        const file = path.join(src, name);

        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, body);
    }

    writeFileSync(path.join(world.stub, `mode.${key}`), mode);
}

/**
 * Runs the real job script as a detached process group leader, as the client's `nohup sh -c` does.
 * `limits` are the script's optional wait and build limits in seconds; `bin` is the PATH folder in front.
 *
 * @sideEffect Spawns a process, recorded so `afterEach` can stop what the test leaves.
 */
function startJob(world: World, job: string, key: string, limits: readonly string[] = [], bin = world.bin): Job {
    const err = openSync(path.join(world.root, `${job}.err`), 'a');
    const child = spawn(BASH, [JOB_SCRIPT, job, key, `ksIos/apps/ios/${key}`, ...limits], {
        detached: true,
        // The job's stderr goes to a file in the world, so a failing case can say why the job died.
        stdio: ['ignore', 'ignore', err],
        env: { HOME: world.home, PATH: `${bin}:${SYSTEM_PATH}`, STUB_DIR: world.stub },
    });

    closeSync(err);
    jobs.push(child);

    if (child.pid === undefined) {
        throw new Error(`the job ${job} did not start`);
    }

    return {
        child,
        pid: child.pid,
        exit: new Promise((resolve) => {
            child.once('exit', (code) => {
                resolve(code);
            });
        }),
    };
}

/** Polls until `ready` holds. Every case synchronizes through this, on files, never on a fixed wait. */
async function until(what: string, ready: () => boolean): Promise<void> {
    const deadline = Date.now() + WAIT_MS;

    while (!ready()) {
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

const marker = (world: World, name: string): string => path.join(world.stub, name);
const started = (world: World, key: string): boolean => existsSync(marker(world, `start.${key}`));

const release = (world: World, key: string): void => {
    writeFileSync(marker(world, `release.${key}`), '');
};

const events = (world: World): string[] =>
    existsSync(marker(world, 'events.log')) ? readFileSync(marker(world, 'events.log'), 'utf8').trim().split('\n') : [];

const stateOf = (world: World, job: string): string => {
    const file = path.join(jobFolder(world, job), 'state');

    return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const pidOf = (world: World, name: string): number => Number(readFileSync(marker(world, name), 'utf8').trim());

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
}

/** Sends SIGKILL to a pid or a group and says nothing when it is already gone. Refuses pids 0, -0, 1 and -1. */
function killQuietly(pid: number): void {
    // Never 0, -0 or 1: `kill(0)` and `kill(-0)` reach this runner's own process group, and 1 is init.
    if (Math.abs(pid) <= 1) {
        return;
    }

    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // Already gone.
    }
}

afterEach(async () => {
    for (const child of jobs.splice(0)) {
        if (child.pid !== undefined) {
            killQuietly(-child.pid);
        }
    }

    for (const world of worlds.splice(0)) {
        for (const name of existsSync(world.stub) ? readdirSync(world.stub) : []) {
            if (name.startsWith('pid.')) {
                killQuietly(pidOf(world, name));
            }
        }

        const survivors = await stopProcessesUnder(world.root);

        rmSync(world.root, { recursive: true, force: true });
        expect(survivors, 'processes left running under the test folder').toEqual([]);
    }
});

describe('iosBuildJob.sh: one build at a time', () => {
    it('⛔ holds a second job until the first has ended, and names the holder while it waits', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to name A as the holder', () =>
            /waiting for the build lock: job=jobA/u.test(stateOf(world, 'jobB')),
        );
        expect(started(world, 'keyB')).toBe(false);

        release(world, 'keyA');
        await until('B to build', () => started(world, 'keyB'));
        release(world, 'keyB');

        expect(await a.exit).toBe(0);
        expect(await b.exit).toBe(0);
        // The two builds are two whole intervals, never interleaved. Mutation: no flock, and B starts inside A.
        expect(events(world)).toEqual(['start keyA', 'end keyA', 'start keyB', 'end keyB']);
    });

    it('⛔ builds each job from its own snapshot, so one job`s upload never reaches another job`s app', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', { marker: 'a' });
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        // B uploads while A builds: the snapshots live in two folders, so this touches nothing A reads.
        upload(world, 'jobB', 'keyB', { marker: 'b' });
        const b = startJob(world, 'jobB', 'keyB');

        release(world, 'keyA');
        await until('B to build', () => started(world, 'keyB'));
        release(world, 'keyB');
        await Promise.all([a.exit, b.exit]);

        expect(readFileSync(path.join(world.home, 'ksIos/apps/ios/keyA/marker'), 'utf8')).toBe('a');
        expect(readFileSync(path.join(world.home, 'ksIos/apps/ios/keyB/marker'), 'utf8')).toBe('b');
    });

    it('⛔ frees the lock when its build leaves a daemon in another session: the next job builds at once', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', {}, 'leaveSession');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA');

        expect(await a.exit).toBe(0);
        const b = startJob(world, 'jobB', 'keyB');

        // Mutation: the build child does not close fd 9. The daemon (a `sleep 300` in its own session, out of reach of
        // the group cleanup) then holds the lock, B waits, and this times out.
        await until('B to build beside the leftover daemon', () => started(world, 'keyB'));
        expect(alive(pidOf(world, 'pid.sleep.keyA'))).toBe(true);
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
    });

    it('⛔ ends a daemon the build left in its own group, before the next job can take the lock', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', {}, 'leaveGroup');
        const a = startJob(world, 'jobA', 'keyA');

        expect(await a.exit).toBe(0);
        // Mutation: skip the group cleanup, and the sleep outlives the job that started it.
        await until('the leftover to be gone', () => !alive(pidOf(world, 'pid.sleep.keyA')));
    });

    it.each(['SIGTERM', 'SIGINT'] as const)(
        '⛔ stops the whole build on %s, exits 143, and leaves the lock to the next job',
        async (signal) => {
            const world = makeWorld();

            upload(world, 'jobA', 'keyA');
            upload(world, 'jobB', 'keyB');
            const a = startJob(world, 'jobA', 'keyA');

            await until('A to build', () => started(world, 'keyA'));
            const build = pidOf(world, 'pid.keyA');

            process.kill(a.pid, signal);

            expect(await a.exit).toBe(143);
            // Mutation: no TERM trap, and the build keeps running in the shared tree while the next job starts.
            expect(alive(build)).toBe(false);
            const b = startJob(world, 'jobB', 'keyB');

            await until('B to take the lock', () => started(world, 'keyB'));
            release(world, 'keyB');
            expect(await b.exit).toBe(0);
        },
    );

    it('⛔ leaves the holder`s record alone when a job that never held the lock is stopped', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to wait for A', () => /waiting for the build lock: job=jobA/u.test(stateOf(world, 'jobB')));
        process.kill(b.pid, 'SIGTERM');
        expect(await b.exit).toBe(143);

        // Mutation: write `released` on every exit, and the live holder A reads as released.
        expect(readFileSync(path.join(buildRoot(world), 'build.owner'), 'utf8')).toMatch(/^job=jobA /u);
        // Mutation: no `rm -rf` of the snapshot on exit, and a stopped waiter leaves its whole upload behind.
        expect(existsSync(path.join(jobFolder(world, 'jobB'), 'src'))).toBe(false);
        release(world, 'keyA');
        expect(await a.exit).toBe(0);
    });

    it('⛔ kills a process in the build group that ignores TERM, before the next job can take the lock', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', {}, 'leaveDeaf');
        const a = startJob(world, 'jobA', 'keyA');

        expect(await a.exit).toBe(0);
        // Mutation: no `kill -KILL` after the bounded wait, and the deaf process outlives the job for good.
        expect(alive(pidOf(world, 'pid.sleep.keyA'))).toBe(false);
    }, 30_000);

    it('⛔ builds job 2 from its own files only: a file only job 1 uploaded is gone from the shared tree', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', { f: 'only in A' });
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        release(world, 'keyA');
        expect(await a.exit).toBe(0);
        upload(world, 'jobB', 'keyB');
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to build', () => started(world, 'keyB'));
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
        // Mutation: no `--delete` on the sync, and B builds with the file A left in the shared tree.
        expect(existsSync(marker(world, 'seen.f.keyA'))).toBe(true);
        expect(existsSync(marker(world, 'seen.f.keyB'))).toBe(false);
    });
});

describe('iosBuildJob.sh: what it leaves behind', () => {
    it('exits with the build`s own code, frees the lock and removes its snapshot when the build fails', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', {}, 'fail3');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA');

        expect(await a.exit).toBe(3);
        expect(existsSync(path.join(jobFolder(world, 'jobA'), 'src'))).toBe(false);
        expect(existsSync(path.join(world.home, 'ksIos/apps/ios/keyA'))).toBe(false);
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to take the lock', () => started(world, 'keyB'));
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
        expect(readFileSync(path.join(buildRoot(world), 'build.owner'), 'utf8')).toMatch(/^released job=jobB/u);
    });

    it('replaces a wrong app already in the app folder, leaves no staging folder, and keeps the lock file', async () => {
        const world = makeWorld();
        const app = path.join(world.home, 'ksIos/apps/ios/keyA');

        mkdirSync(app, { recursive: true });
        writeFileSync(path.join(app, 'wrong'), 'x');
        upload(world, 'jobA', 'keyA', { marker: 'a' });
        upload(world, 'jobB', 'keyB');
        release(world, 'keyA');
        release(world, 'keyB');

        expect(await startJob(world, 'jobA', 'keyA').exit).toBe(0);
        const lockInode = statSync(path.join(buildRoot(world), 'build.lock')).ino;

        expect(existsSync(path.join(app, 'wrong'))).toBe(false);
        expect(readFileSync(path.join(app, 'marker'), 'utf8')).toBe('a');
        expect(
            readdirSync(path.join(world.home, 'ksIos/apps/ios')).filter((name) => name.startsWith('.staging')),
        ).toEqual([]);
        // A second job reuses the same lock file: deleting a held flock file would let two holders in.
        expect(await startJob(world, 'jobB', 'keyB').exit).toBe(0);
        expect(statSync(path.join(buildRoot(world), 'build.lock')).ino).toBe(lockInode);
    });

    it('installs from the public npm registry, whatever registry the Mac user`s own npm configuration names', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', {}, 'fail3');
        const a = startJob(world, 'jobA', 'keyA');

        await a.exit;
        // The first real build failed on `getaddrinfo ENOTFOUND` for a registry named in the Mac user's ~/.npmrc: npm rewrites
        // the lockfile's registry host to the configured one. Mutation: drop the override, and `npm ci` asks that registry.
        expect(readFileSync(marker(world, 'tools.log'), 'utf8')).toContain(
            'npm ci registry=https://registry.npmjs.org/',
        );
    });

    it('syncs the build tree by content: a file of the same size and time but other bytes is replaced', async () => {
        const world = makeWorld();
        const work = path.join(buildRoot(world), 'work', 'src');
        const when = new Date('2026-01-01T00:00:00Z');

        mkdirSync(work, { recursive: true });
        writeFileSync(path.join(work, 'f'), 'AAAA');
        utimesSync(path.join(work, 'f'), when, when);
        upload(world, 'jobA', 'keyA', { f: 'BBBB' });
        utimesSync(path.join(jobFolder(world, 'jobA'), 'src', 'f'), when, when);
        release(world, 'keyA');

        expect(await startJob(world, 'jobA', 'keyA').exit).toBe(0);
        // Mutation: rsync without `--checksum` sees size and time match and keeps the other squad's bytes.
        expect(readFileSync(marker(world, 'seen.f.keyA'), 'utf8')).toBe('BBBB');
    });
});

/** The text the job wrote to its stderr, which is where a refusal says why. */
const errOf = (world: World, job: string): string => {
    const file = path.join(world.root, `${job}.err`);

    return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

/** A process of its own group that stays until the test ends: stands for a live holder or a live old build. */
function liveGroupLeader(): ChildProcess {
    const child = spawn('/bin/sleep', ['300'], { detached: true, stdio: 'ignore' });

    jobs.push(child);

    return child;
}

/** The boot the script records: the kernel's boot id, as `iosBuildJob.sh` writes it. */
const bootOf = (): string => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').replaceAll(/\s/gu, '_');

const AGES = { old: 3 * 24 * 3600, fresh: 0 } as const;

function ageFolder(folder: string, ageSeconds: number): void {
    const then = new Date(Date.now() - ageSeconds * 1000);

    utimesSync(folder, then, then);
}

describe('iosBuildJob.sh: a build group that outlived its wrapper (stale holder)', () => {
    it('⛔ refuses to build beside a live group of an earlier job, and builds once that group has ended', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        const group = Number(/pgid=(\d+)/u.exec(readFileSync(path.join(buildRoot(world), 'build.owner'), 'utf8'))?.[1]);

        // The wrapper dies without cleaning up: the kernel frees the lock, and the build group runs on.
        process.kill(a.pid, 'SIGKILL');
        await a.exit;
        upload(world, 'jobB', 'keyB');
        const b = startJob(world, 'jobB', 'keyB');

        // Mutation: no stale-holder check, and B builds beside A's live group in the shared tree.
        expect(await b.exit).toBe(75);
        expect(errOf(world, 'jobB')).toMatch(/earlier build \(job jobA, process group \d+\) still runs/u);
        expect(started(world, 'keyB')).toBe(false);

        killQuietly(-group);
        await until('A`s group to end', () => !alive(group));
        upload(world, 'jobC', 'keyC');
        const c = startJob(world, 'jobC', 'keyC');

        await until('C to build', () => started(world, 'keyC'));
        release(world, 'keyC');
        expect(await c.exit).toBe(0);
    });

    it('does not refuse for a recorded group whose start time is not the live process`s (a reused group id)', async () => {
        const world = makeWorld();
        const reused = liveGroupLeader();

        mkdirSync(buildRoot(world), { recursive: true });
        writeFileSync(
            path.join(buildRoot(world), 'build.owner'),
            `job=old pid=1 pgid=${String(reused.pid ?? 0)} since=then lstart=Mon Jan  1 00:00:00 2001\n`,
        );
        upload(world, 'jobB', 'keyB');
        const b = startJob(world, 'jobB', 'keyB');

        // Mutation: judge by "a process in the group is alive" alone, and a reused group id blocks every build.
        await until('B to build', () => started(world, 'keyB'));
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
    });
});

describe('iosBuildJob.sh: the limits', () => {
    it('⛔ stops a build that outlasts its limit: exit 124, the group gone, the lock free', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA', ['10800', '1']);

        await until('A to build', () => started(world, 'keyA'));
        const build = pidOf(world, 'pid.keyA');

        // Mutation: no limit, and a hung build holds the lock until someone stops it.
        expect(await a.exit).toBe(124);
        expect(alive(build)).toBe(false);
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to take the lock', () => started(world, 'keyB'));
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
    });

    it('⛔ names itself as the holder while it syncs, so a waiter never reads the previous holder`s line', async () => {
        const world = makeWorld();
        const slowBin = path.join(world.root, 'slowBin');

        mkdirSync(slowBin);
        // A rsync that says it has started and waits, so the job is held inside its sync step.
        writeFileSync(
            path.join(slowBin, 'rsync'),
            `#!/usr/bin/env bash\ntouch "$STUB_DIR/syncing"\nwhile [ ! -f "$STUB_DIR/syncGo" ]; do sleep 0.05; done\nexec /usr/bin/rsync "$@"\n`,
        );
        chmodSync(path.join(slowBin, 'rsync'), 0o755);
        // The previous holder's record: what a waiter would read if the new holder wrote nothing.
        mkdirSync(buildRoot(world), { recursive: true });
        writeFileSync(path.join(buildRoot(world), 'build.owner'), 'released job=jobOld since=then\n');
        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA', [], `${slowBin}:${world.bin}`);

        await until('A to be inside its sync', () => existsSync(marker(world, 'syncing')));
        const b = startJob(world, 'jobB', 'keyB', ['1']);

        // Mutation: write the holder record after the sync, and B reads `released job=jobOld` here.
        await until('B to name A', () => /waiting for the build lock: job=jobA /u.test(stateOf(world, 'jobB')));
        expect(await b.exit).toBe(75);
        writeFileSync(marker(world, 'syncGo'), '');
        await until('A to build', () => started(world, 'keyA'));
        release(world, 'keyA');
        expect(await a.exit).toBe(0);
    });

    it('⛔ never exits 75 for a build that itself exits 75, because 75 means the lock was not taken', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA', {}, 'fail75');
        const a = startJob(world, 'jobA', 'keyA');

        // Mutation: pass the build's code through, and the client reads a failed build as "the lock was not taken".
        expect(await a.exit).toBe(1);
        expect(errOf(world, 'jobA')).toContain('exited 75');
    });

    it('⛔ gives up waiting for the lock after its limit: exit 75, naming the holder', async () => {
        const world = makeWorld();

        mkdirSync(buildRoot(world), { recursive: true });
        writeFileSync(path.join(buildRoot(world), 'build.owner'), 'job=other pid=1 pgid=2 since=then lstart=x\n');
        // The lock is held from outside the script, as another squad's job holds it.
        const holder = spawn(
            '/usr/bin/perl',
            [
                '-e',
                'use Fcntl qw(:flock); $| = 1; open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; print "held\\n"; sleep 300',
                path.join(buildRoot(world), 'build.lock'),
            ],
            { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
        );

        jobs.push(holder);
        await new Promise((resolve) => holder.stdout.once('data', resolve));
        upload(world, 'jobB', 'keyB');
        const b = startJob(world, 'jobB', 'keyB', ['1']);

        // Mutation: wait for ever.
        expect(await b.exit).toBe(75);
        expect(errOf(world, 'jobB')).toContain('job=other');
        expect(started(world, 'keyB')).toBe(false);
    });
});

describe('iosBuildJob.sh: what perl says about the lock', () => {
    /** A `perl` first on PATH that answers for the checks the job makes, and runs the real one otherwise. */
    function withFakePerl(world: World, body: string): string {
        const bin = path.join(world.root, 'fakeperl');

        mkdirSync(bin, { recursive: true });
        writeFileSync(path.join(bin, 'perl'), `#!/bin/bash\n${body}\nexec /usr/bin/perl "$@"\n`);
        chmodSync(path.join(bin, 'perl'), 0o755);

        return `${bin}:${world.bin}`;
    }

    it('⛔ refuses a perl whose flock is emulated, because emulated flock gives no exclusion at all', async () => {
        const world = makeWorld();
        const bin = withFakePerl(world, 'case "$*" in *d_flock*) exit 1 ;; esac');

        upload(world, 'jobA', 'keyA');
        const a = startJob(world, 'jobA', 'keyA', [], bin);

        // Mutation: skip the check, and the stub build starts.
        expect(await a.exit).toBe(1);
        expect(errOf(world, 'jobA')).toContain('flock');
        expect(started(world, 'keyA')).toBe(false);
    });

    it('⛔ dies on a flock error that is not "busy", instead of waiting for ever', async () => {
        const world = makeWorld();
        const bin = withFakePerl(world, 'case "$*" in *LOCK_NB*) exit 2 ;; esac');

        upload(world, 'jobA', 'keyA');
        const a = startJob(world, 'jobA', 'keyA', [], bin);

        // Mutation: read exit 2 as "busy", and the job waits its whole limit for a lock nobody holds.
        expect(await a.exit).toBe(1);
        expect(errOf(world, 'jobA')).toContain('could not take the build lock');
    });
});

describe('iosBuildJob.sh: the lock file is replaced under a waiter', () => {
    it('⛔ a waiter takes the lock on the file that is there now, and a later job waits for it, not beside it', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        upload(world, 'jobC', 'keyC');
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to wait', () => /waiting for the build lock/u.test(stateOf(world, 'jobB')));
        rmSync(path.join(buildRoot(world), 'build.lock'));
        release(world, 'keyA');
        await a.exit;
        await until('B to build', () => started(world, 'keyB'));
        const c = startJob(world, 'jobC', 'keyC');

        await until('C to wait for B', () => /waiting for the build lock: job=jobB/u.test(stateOf(world, 'jobC')));
        // Mutation: lock a file other than the one at the path, and C builds beside B.
        expect(existsSync(path.join(buildRoot(world), 'build.lock'))).toBe(true);
        expect(started(world, 'keyC')).toBe(false);
        release(world, 'keyB');
        await b.exit;
        await until('C to build', () => started(world, 'keyC'));
        release(world, 'keyC');
        expect(await c.exit).toBe(0);
    });
});

describe('iosBuildJob.sh: the lock file removed between the open and the flock', () => {
    it('⛔ does not build on a lock file that was removed, and locks the one at the path', async () => {
        const world = makeWorld();
        const bin = path.join(world.root, 'fakeperl');

        mkdirSync(bin, { recursive: true });
        // The first lock attempt finds the file gone, as if another squad cleared the folder after the job opened it.
        writeFileSync(
            path.join(bin, 'perl'),
            '#!/bin/bash\ncase "$*" in *LOCK_NB*) [ -e "$STUB_DIR/removed" ] || { touch "$STUB_DIR/removed"; rm -f build.lock; } ;; esac\nexec /usr/bin/perl "$@"\n',
        );
        chmodSync(path.join(bin, 'perl'), 0o755);
        upload(world, 'jobA', 'keyA');
        const a = startJob(world, 'jobA', 'keyA', [], `${bin}:${world.bin}`);

        await until('A to build', () => started(world, 'keyA'));
        // Mutation: no inode check, and A holds a lock on a file nobody can reach, so a second job takes the real one.
        expect(existsSync(path.join(buildRoot(world), 'build.lock'))).toBe(true);
        release(world, 'keyA');
        expect(await a.exit).toBe(0);
    });
});

describe('iosBuildJob.sh: pruning', () => {
    it('removes old job folders that finished or lost their wrapper and old staging folders, and nothing that is alive', async () => {
        const world = makeWorld();
        const alivePid = liveGroupLeader().pid ?? 0;

        const make = (name: string, files: Record<string, string>, age: number): string => {
            const folder = jobFolder(world, name);

            mkdirSync(folder, { recursive: true });

            for (const [file, body] of Object.entries(files)) {
                writeFileSync(path.join(folder, file), body);
            }

            ageFolder(folder, age);

            return folder;
        };

        const finished = make('oldFinished', { 'build.rc': '0\n' }, AGES.old);
        const lost = make('oldLost', { wrapper: `999999 ${bootOf()}\n` }, AGES.old);
        const rebooted = make('oldRebooted', { wrapper: `${String(alivePid)} otherboot\n` }, AGES.old);
        const running = make('oldRunning', { wrapper: `${String(alivePid)} ${bootOf()}\n` }, AGES.old);
        const recent = make('recent', { 'build.rc': '0\n' }, AGES.fresh);
        const staging = path.join(world.home, 'ksIos', 'apps', 'ios', '.staging.oldJob');

        mkdirSync(staging, { recursive: true });
        ageFolder(staging, AGES.old);
        upload(world, 'jobB', 'keyB');
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to build', () => started(world, 'keyB'));
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
        // Mutation: prune nothing, prune by age alone (running goes), or skip the staging folders.
        expect([finished, lost, rebooted, staging].map((folder) => existsSync(folder))).toEqual([
            false,
            false,
            false,
            false,
        ]);
        expect([running, recent].map((folder) => existsSync(folder))).toEqual([true, true]);
    });
});
