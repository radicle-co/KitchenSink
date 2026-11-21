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

import { afterEach, describe, expect, it } from 'vitest';

const JOB_SCRIPT = fileURLToPath(new URL('../mac/iosBuildJob.sh', import.meta.url));
const SYSTEM_PATH = '/usr/bin:/bin';
const WAIT_MS = 15_000;
const BUILD_STUB = 'packages/apps/commise/mobile/scripts/buildTestApp.sh';

/** What the stub build does for one key, written to `mode.<key>`. */
type StubMode = 'block' | 'fail3' | 'leaveGroup' | 'leaveSession';

interface World {
    readonly root: string;
    readonly home: string;
    /** The stub's marker folder: `start.<key>`, `release.<key>`, `pid.<key>`, `events.log`. */
    readonly stub: string;
    readonly bin: string;
}

interface Job {
    readonly child: ChildProcess;
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
    leaveSession) setsid sleep 300 > /dev/null 2>&1 & echo $! > "$STUB_DIR/pid.sleep.$k"; sleep 0.2 ;;
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
            `#!/usr/bin/env bash\necho "${tool} $*" >> "$STUB_DIR/tools.log"\n[ "${tool} $1" = "npm ci" ] && mkdir -p node_modules\nexit 0\n`,
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
 *
 * @sideEffect Spawns a process, recorded so `afterEach` can stop what the test leaves.
 */
function startJob(world: World, job: string, key: string): Job {
    const err = openSync(path.join(world.root, `${job}.err`), 'a');
    const child = spawn('bash', [JOB_SCRIPT, job, key, `ksIos/apps/ios/${key}`], {
        detached: true,
        // The job's stderr goes to a file in the world, so a failing case can say why the job died.
        stdio: ['ignore', 'ignore', err],
        env: { HOME: world.home, PATH: `${world.bin}:${SYSTEM_PATH}`, STUB_DIR: world.stub },
    });

    closeSync(err);
    jobs.push(child);

    return { child, exit: new Promise((resolve) => child.once('exit', (code) => resolve(code))) };
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
const release = (world: World, key: string): void => writeFileSync(marker(world, `release.${key}`), '');
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

afterEach(() => {
    for (const child of jobs.splice(0)) {
        if (child.pid !== undefined) {
            try {
                process.kill(-child.pid, 'SIGKILL');
            } catch {
                // The group is already gone.
            }
        }
    }

    for (const world of worlds.splice(0)) {
        for (const name of existsSync(world.stub) ? readdirSync(world.stub) : []) {
            if (name.startsWith('pid.')) {
                try {
                    process.kill(pidOf(world, name), 'SIGKILL');
                } catch {
                    // Already gone.
                }
            }
        }

        rmSync(world.root, { recursive: true, force: true });
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

    it('⛔ stops the whole build on TERM, exits 143, and leaves the lock to the next job', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        const build = pidOf(world, 'pid.keyA');

        process.kill(a.child.pid ?? 0, 'SIGTERM');

        expect(await a.exit).toBe(143);
        // Mutation: no TERM trap, and the build keeps running in the shared tree while the next job starts.
        expect(alive(build)).toBe(false);
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to take the lock', () => started(world, 'keyB'));
        release(world, 'keyB');
        expect(await b.exit).toBe(0);
    });

    it('⛔ leaves the holder`s record alone when a job that never held the lock is stopped', async () => {
        const world = makeWorld();

        upload(world, 'jobA', 'keyA');
        upload(world, 'jobB', 'keyB');
        const a = startJob(world, 'jobA', 'keyA');

        await until('A to build', () => started(world, 'keyA'));
        const b = startJob(world, 'jobB', 'keyB');

        await until('B to wait for A', () => /waiting for the build lock: job=jobA/u.test(stateOf(world, 'jobB')));
        process.kill(b.child.pid ?? 0, 'SIGTERM');
        expect(await b.exit).toBe(143);

        // Mutation: write `released` on every exit, and the live holder A reads as released.
        expect(readFileSync(path.join(buildRoot(world), 'build.owner'), 'utf8')).toMatch(/^job=jobA /u);
        release(world, 'keyA');
        expect(await a.exit).toBe(0);
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
