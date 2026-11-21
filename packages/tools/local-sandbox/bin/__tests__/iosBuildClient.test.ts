/**
 * The WSL side of the iOS build, `bin/mac/buildIosApp.sh build` (CL-MACLOCK, staff S91): upload a snapshot, start the job
 * on the Mac, poll it, and say what it found.
 *
 * Each case runs the REAL client and the REAL job script (`iosBuildJob.sh`, copied into a temp git repo that stands for
 * the tree to build). Two things are faked: `ssh` runs its command in a local `bash` with HOME set to a temp folder that
 * stands for the Mac's, and `rsync` drops the `host:` part of its target and then runs the real `rsync`. The build itself
 * is a stub in the repo. Nothing here touches a Mac or a network.
 *
 * What these cases prove, which a mock of the commands cannot: that the files uploaded are the repo's own (tracked plus
 * untracked, never ignored), that no command or upload names a path the old script used, that two builds never share a
 * result file, and that the client tells a held lock, a state change and a dead wrapper apart.
 *
 * Gap for the follow-up PR (staff S91, PR 2): the limits on waiting and building are not here.
 */
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { macPathsOf } from '../../src/maestroLanes/macSession.js';

const CLIENT = fileURLToPath(new URL('../mac/buildIosApp.sh', import.meta.url));
const REAL_JOB_SCRIPT = fileURLToPath(new URL('../mac/iosBuildJob.sh', import.meta.url));
const JOB_PATH = 'packages/tools/local-sandbox/bin/mac/iosBuildJob.sh';
const BUILD_STUB_PATH = 'packages/apps/commise/mobile/scripts/buildTestApp.sh';
const KEY = 'abc123';
const APP = macPathsOf().iosApp(KEY);
const PUBLISHABLE = 'pk_test_FAKEPUBLISHABLE';
const TIMEOUT_MS = 90_000;
/** The limit of the case that runs two client builds, in milliseconds. */
const TWO_BUILDS_TIMEOUT_MS = 30_000;
/** Absolute, so the test never resolves a command through a PATH it does not control. */
const BASH = '/bin/bash';
const GIT = '/usr/bin/git';

/** The build stub: `verify-manifest` accepts, `ios` makes the folder the job publishes. */
const BUILD_STUB_BODY = `#!/usr/bin/env bash
case "$1" in
    verify-manifest) exit 0 ;;
    ios)
        mkdir -p packages/apps/commise/mobile/dist-testApp/ios stage
        echo built > stage/Fake.app
        tar -czf packages/apps/commise/mobile/dist-testApp/ios/app.tar.gz -C stage .
        rm -rf stage
        echo "contentKey=$TEST_APP_CONTENT_KEY" > packages/apps/commise/mobile/dist-testApp/ios/testApp.manifest
        ;;
esac
`;

interface World {
    readonly root: string;
    readonly macHome: string;
    readonly bin: string;
    readonly sshLog: string;
    readonly rsyncLog: string;
}

const roots: string[] = [];

const git = (cwd: string, ...args: string[]): void => {
    const result = spawnSync(GIT, args, { cwd, encoding: 'utf8' });

    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    }
};

function writeExecutable(file: string, body: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    chmodSync(file, 0o755);
}

/**
 * A fake Mac HOME, fake `ssh` and `rsync`, and stub `npm`, `npx` and `xcodebuild` on a bin folder.
 *
 * @sideEffect Creates files under the OS temp directory; `afterEach` removes them.
 */
function makeWorld(): World {
    const root = mkdtempSync(path.join(tmpdir(), 'iosBuildClient-'));
    const world: World = {
        root,
        macHome: path.join(root, 'machome'),
        bin: path.join(root, 'bin'),
        sshLog: path.join(root, 'ssh.log'),
        rsyncLog: path.join(root, 'rsync.log'),
    };

    mkdirSync(world.macHome);
    roots.push(root);

    // The command is the last argument. HOME is the Mac's, and so is the working folder, as for a login on the Mac.
    writeExecutable(
        path.join(world.bin, 'ssh'),
        `#!/usr/bin/env bash\ncmd="\${@: -1}"\nprintf 'SSH %s\\n' "$cmd" >> "${world.sshLog}"\n` +
            `cd "${world.macHome}"\nexport HOME="${world.macHome}"\nexec bash -c "$cmd"\n`,
    );
    // `-e <ssh command>` is dropped and `host:` becomes the Mac's HOME, as a login would resolve it: the real rsync then copies locally.
    writeExecutable(
        path.join(world.bin, 'rsync'),
        `#!/usr/bin/env bash\nargs=()\nskip=0\nfor a in "$@"; do\n    if [ "$skip" = 1 ]; then skip=0; continue; fi\n` +
            `    if [ "$a" = -e ]; then skip=1; continue; fi\n    args+=("\${a/#mac.example:/${world.macHome}/}")\ndone\n` +
            `printf 'RSYNC %s\\n' "$*" >> "${world.rsyncLog}"\nexec /usr/bin/rsync "\${args[@]}"\n`,
    );

    for (const tool of ['npm', 'npx']) {
        writeExecutable(
            path.join(world.bin, tool),
            `#!/usr/bin/env bash\n[ "${tool} $1" = "npm ci" ] && mkdir -p node_modules\nexit 0\n`,
        );
    }

    writeExecutable(
        path.join(world.bin, 'xcodebuild'),
        `#!/usr/bin/env bash\nprintf 'Xcode 27.2\\nBuild version 27B52\\n'\n`,
    );

    return world;
}

/**
 * A git repo standing for the tree to build: the stub build, a job script, and any extra files, all committed.
 *
 * @sideEffect Creates files under the world's root.
 */
function makeRepo(world: World, jobScript: string, files: Record<string, string> = {}): string {
    const repo = path.join(world.root, 'repo');
    const all: Record<string, string> = {
        'package-lock.json': '{}',
        '.gitignore': '.env.local\nignored/\n',
        [BUILD_STUB_PATH]: BUILD_STUB_BODY,
        [JOB_PATH]: jobScript,
        ...files,
    };

    mkdirSync(repo);
    git(repo, 'init', '-q');

    for (const [name, body] of Object.entries(all)) {
        writeExecutable(path.join(repo, name), body);
    }

    git(repo, 'add', '.');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'fixture');

    return repo;
}

/** Runs the real client's `build`, and returns once it has exited. */
function build(world: World, repo: string, env: Record<string, string> = {}) {
    return spawnSync(BASH, [CLIENT, 'build', KEY, APP], {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: {
            PATH: `${world.bin}:/usr/bin:/bin`,
            HOME: world.root,
            KS_MAC_HOST: 'mac.example',
            KS_MAC_SSH_CONFIG: path.join(world.root, 'ssh.conf'),
            KS_MAC_PATH: `${world.bin}:/usr/bin:/bin`,
            KS_MAC_NODE_BIN: world.bin,
            KS_REPO_ROOT: repo,
            KS_MAC_POLL_SECONDS: '1',
            CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
            ...env,
        },
    });
}

const buildRoot = (world: World): string => path.join(world.macHome, 'ksIos', 'build.noindex');
const sshCommands = (world: World): string[] =>
    readFileSync(world.sshLog, 'utf8')
        .split(/^SSH /mu)
        .filter((entry) => entry !== '');
const jobIdsIn = (text: string): string[] => [
    ...new Set(Array.from(text.matchAll(/jobs\/([A-Za-z0-9._-]+)/gu), ([, id]) => id)),
];

/** What the real job script is told to do when the test wants to stand it in with its own behaviour. */
const fakeJob = (body: string): string =>
    `#!/usr/bin/env bash\njob="$1"\nd="$HOME/ksIos/build.noindex/jobs/$job"\n${body}\n`;

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('buildIosApp.sh build: the upload', () => {
    it('sends the tracked and the untracked files, never an ignored one, and survives a tracked file deleted from the tree', () => {
        const world = makeWorld();
        const repo = makeRepo(world, readFileSync(REAL_JOB_SCRIPT, 'utf8'), {
            'tracked.txt': 'tracked',
            'gone.txt': 'will be deleted',
        });

        rmSync(path.join(repo, 'gone.txt'));
        writeFileSync(path.join(repo, 'untracked.txt'), 'untracked');
        writeFileSync(path.join(repo, '.env.local'), 'SECRET=1');
        mkdirSync(path.join(repo, 'ignored'));
        writeFileSync(path.join(repo, 'ignored', 'big.bin'), 'x');

        const result = build(world, repo);
        const tree = path.join(buildRoot(world), 'work', 'src');

        // Mutations: no `--others` (untracked.txt missing), no `--exclude-standard` (the secret and the folder arrive),
        // no `--ignore-missing-args` (the deleted file fails the upload, and so the build).
        expect(result.status, result.stderr).toBe(0);
        expect(existsSync(path.join(tree, 'tracked.txt'))).toBe(true);
        expect(existsSync(path.join(tree, 'untracked.txt'))).toBe(true);
        expect(existsSync(path.join(tree, '.env.local'))).toBe(false);
        expect(existsSync(path.join(tree, 'ignored'))).toBe(false);
        expect(existsSync(path.join(tree, 'gone.txt'))).toBe(false);
        expect(existsSync(path.join(tree, '.git'))).toBe(false);
    });

    it('publishes the app under ksIos/apps/ios/<key> and removes the job folder when the build passed', () => {
        const world = makeWorld();
        const repo = makeRepo(world, readFileSync(REAL_JOB_SCRIPT, 'utf8'));

        const result = build(world, repo);

        expect(result.status, result.stderr).toBe(0);
        expect(APP).toBe(`ksIos/apps/ios/${KEY}`);
        expect(readFileSync(path.join(world.macHome, APP, 'testApp.manifest'), 'utf8')).toBe(`contentKey=${KEY}\n`);
        // The old place stays empty: an old script reading it would otherwise find a half-built app.
        expect(existsSync(path.join(world.macHome, 'ksIos', 'apps', KEY))).toBe(false);
        expect(readdirSync(path.join(buildRoot(world), 'jobs'))).toEqual([]);
    });
});

describe('buildIosApp.sh build: paths an old script writes', () => {
    it('⛔ names none of them in any command or upload', () => {
        const world = makeWorld();
        const repo = makeRepo(world, readFileSync(REAL_JOB_SCRIPT, 'utf8'));

        const result = build(world, repo);
        const everything = `${sshCommands(world).join('\n')}\n${readFileSync(world.rsyncLog, 'utf8')}`;

        expect(result.status, result.stderr).toBe(0);
        // What lives in a job's own folder is fine; what an old script shares is not.
        const outsideJobs = everything.replace(/build\.noindex\/jobs\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*/gu, '');

        expect(outsideJobs).not.toMatch(/build\.noindex\/(src|tmp|build\.sh|build\.rc|build\.log|lock\.sha)\b/u);
        expect(everything).not.toMatch(new RegExp(`ksIos/apps/${KEY}\\b`, 'u'));
        expect(everything).toContain(`ksIos/apps/ios/${KEY}`);
    });
});

describe('buildIosApp.sh build: one result file for one job', () => {
    it(
        '⛔ gives two builds begun in the same second two different job ids',
        () => {
            const world = makeWorld();
            // The job ends at once with a failure: this case is about the id, so it does not wait for a real build.
            const repo = makeRepo(world, fakeJob('exit 3'));

            // The clock stands still, as it does for two builds begun in the same second: only the pid tells the ids apart.
            // Mutation: drop `-$$` from the id, and the second build reuses the first one's folder name.
            writeExecutable(path.join(world.bin, 'date'), '#!/usr/bin/env bash\necho 20261121T000000Z\n');

            // The ssh log is emptied between the runs, so each run's commands are told apart.
            const first = build(world, repo, { KS_MAC_POLL_SECONDS: '0' });
            const firstIds = jobIdsIn(readFileSync(world.sshLog, 'utf8'));

            writeFileSync(world.sshLog, '');
            const second = build(world, repo, { KS_MAC_POLL_SECONDS: '0' });
            const secondIds = jobIdsIn(readFileSync(world.sshLog, 'utf8'));

            expect(first.stderr).toContain('exit 3');
            expect(second.stderr).toContain('exit 3');
            expect(firstIds).toHaveLength(1);
            expect(secondIds).toHaveLength(1);
            expect(firstIds).not.toEqual(secondIds);
        },
        // Two client runs are two dozen short processes each (git, rsync, ssh, bash). Measured on an idle machine and with
        // every core busy (see the commit message); the limit is a multiple of the loaded time, never a guess.
        TWO_BUILDS_TIMEOUT_MS,
    );
});

describe('buildIosApp.sh build: what the Mac says back', () => {
    it('⛔ refuses with the holder named when the job gives up on the lock (exit 75), and prints a state change once', () => {
        const world = makeWorld();
        const repo = makeRepo(
            world,
            fakeJob(
                `printf '%s %s\\n' "$$" x > "$d/wrapper"\n` +
                    `printf 'waiting for the build lock: job=other\\n' > "$d/state"\nsleep 3\n` +
                    `printf 'job=other pid=1 pgid=2 since=then\\n' > "$HOME/ksIos/build.noindex/build.owner"\nexit 75`,
            ),
        );

        const result = build(world, repo);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('job=other');
        expect(result.stderr.match(/waiting for the build lock: job=other/gu)).toHaveLength(1);
    });

    it('⛔ dies and names the job when the Mac rebooted since the wrapper started, even if its pid is alive again', () => {
        const world = makeWorld();
        // A live pid (this job's own) beside a boot id that is not the Mac's: a reused pid after a reboot.
        const repo = makeRepo(world, fakeJob(`printf '%s %s\\n' "$$" otherboot > "$d/wrapper"\nsleep 15\nexit 0`));

        const result = build(world, repo);
        const [job] = jobIdsIn(sshCommands(world).join('\n'));

        // Mutation: poll only `kill -0`, and the client waits for a build the reboot already ended.
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(job).toBeDefined();
        expect(result.stderr).toContain(job);
    });

    it('keeps the job folder and shows the log tail when the build failed', () => {
        const world = makeWorld();
        const repo = makeRepo(
            world,
            fakeJob(`printf '%s %s\\n' "$$" x > "$d/wrapper"\necho 'the compiler said no'\nexit 3`),
        );

        const result = build(world, repo);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('the compiler said no');
        expect(result.stderr).toContain('exit 3');
        expect(readdirSync(path.join(buildRoot(world), 'jobs'))).toHaveLength(1);
    });

    it('⛔ dies and names the job when the wrapper is gone and left no result', () => {
        const world = makeWorld();
        const bootId = `$(cat /proc/sys/kernel/random/boot_id | tr " \\n" "__")`;
        const repo = makeRepo(
            world,
            fakeJob(`printf '%s %s\\n' "$$" "${bootId}" > "$d/wrapper"\nkill -9 "$PPID"\nexit 0`),
        );

        const result = build(world, repo);
        const [job] = jobIdsIn(sshCommands(world).join('\n'));

        // Without this the client would poll for a result that never comes, for ever.
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(job).toBeDefined();
        expect(result.stderr).toContain(job);
    });
});
