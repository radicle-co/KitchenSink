// @vitest-environment node
/**
 * The add flow of `scripts/worktreeAdd.mjs` on a throwaway git repository with a tiny lockfile and a fake `npm` on
 * `PATH` that "installs" one root package and one workspace package.
 *
 * What a mock of `git` or `fs` could not prove, and this does: the worktree really exists, its `node_modules` really
 * is hard-linked (same inode) to the shared install, a second worktree on the same lockfile runs NO install, a killed
 * install leaves nothing reusable, and an old install is pruned while the one a live worktree needs stays.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lockfileHash } from '../../../../scripts/worktreeAdd.mjs';

const script = path.resolve(import.meta.dirname, '../../../../scripts/worktreeAdd.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'worktreeAdd-'));
const repo = path.join(scratch, 'repo');
const bin = path.join(scratch, 'bin');
const installRoot = path.join(scratch, 'installs');
const npmLog = path.join(scratch, 'npm.log');
const lock = '{"lockfileVersion":3,"packages":{}}\n';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

const run = (args: string[], extraEnv: Record<string, string> = {}): string =>
    execFileSync('node', [script, ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            KS_INSTALL_ROOT: installRoot,
            KS_FAKE_NPM_LOG: npmLog,
            ...extraEnv,
        },
    });

const npmCalls = (): number => (existsSync(npmLog) ? readFileSync(npmLog, 'utf8').trim().split('\n').length : 0);

describe('worktree:add', () => {
    beforeAll(() => {
        mkdirSync(repo);
        mkdirSync(bin);
        git(repo, 'init', '-q', '-b', 'main');
        git(repo, 'config', 'user.email', 't@example.com');
        git(repo, 'config', 'user.name', 't');
        writeFileSync(path.join(repo, 'package-lock.json'), lock);
        writeFileSync(path.join(repo, 'package.json'), '{"name":"r","workspaces":["packages/a"]}\n');
        mkdirSync(path.join(repo, 'packages/a'), { recursive: true });
        writeFileSync(path.join(repo, 'packages/a/package.json'), '{"name":"a"}\n');
        git(repo, 'add', 'package-lock.json', 'package.json', 'packages/a/package.json');
        git(repo, 'commit', '-q', '-m', 'init');
        // Fake npm: `npm ci` writes a root and a workspace node_modules, and logs one line per call. KS_FAKE_NPM_FAIL
        // makes it die half way, the way a killed install does.
        writeFileSync(
            path.join(bin, 'npm'),
            [
                '#!/bin/sh',
                'echo "$@" >> "$KS_FAKE_NPM_LOG"',
                'mkdir -p node_modules/dep packages/a/node_modules/inner',
                'echo root > node_modules/dep/index.js',
                '[ -n "$KS_FAKE_NPM_FAIL" ] && exit 1',
                'echo inner > packages/a/node_modules/inner/index.js',
                'echo root > node_modules/.package-lock.json',
                'echo inner > packages/a/node_modules/.package-lock.json',
                'mkdir -p node_modules/.bin',
                "printf '#!/bin/sh\\nmkdir -p .husky/_ && echo hook > .husky/_/pre-commit\\n' > node_modules/.bin/husky",
                'chmod +x node_modules/.bin/husky',
                '',
            ].join('\n'),
            { mode: 0o755 },
        );
    });

    afterAll(() => {
        rmSync(scratch, { recursive: true, force: true });
    });

    it('adds the worktree and hard-links its node_modules from an install keyed by the lockfile hash', () => {
        const wt = path.join(scratch, 'wt1');
        run([wt, 'feature/one']);

        const hash = lockfileHash(Buffer.from(lock));
        const shared = path.join(installRoot, hash);

        expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/one');
        expect(statSync(path.join(wt, 'node_modules/dep/index.js')).ino).toBe(
            statSync(path.join(shared, 'node_modules/dep/index.js')).ino,
        );
        expect(statSync(path.join(wt, 'packages/a/node_modules/inner/index.js')).ino).toBe(
            statSync(path.join(shared, 'packages/a/node_modules/inner/index.js')).ino,
        );
        expect(readdirSync(installRoot)).toEqual([hash]);
        expect(npmCalls()).toBe(1);
        expect(existsSync(path.join(wt, '.husky/_/pre-commit'))).toBe(true);
    });

    it('a second worktree on the same lockfile reuses the install and runs no npm', () => {
        const wt = path.join(scratch, 'wt2');
        run([wt, 'feature/two', 'main']);

        expect(existsSync(path.join(wt, 'node_modules/dep/index.js'))).toBe(true);
        expect(existsSync(path.join(wt, 'packages/a/node_modules/inner/index.js'))).toBe(true);
        expect(npmCalls()).toBe(1);
        // A cache hit runs no npm, so no `prepare`: the hooks folder git's core.hooksPath names must still be made.
        expect(existsSync(path.join(wt, '.husky/_/pre-commit'))).toBe(true);
    });

    it('writing a worktree`s .package-lock.json in place leaves the shared install and its siblings unchanged', () => {
        const hash = lockfileHash(Buffer.from(lock));
        const shared = path.join(installRoot, hash);
        const wt = path.join(scratch, 'wt2');

        for (const rel of ['node_modules/.package-lock.json', 'packages/a/node_modules/.package-lock.json']) {
            expect(statSync(path.join(wt, rel)).ino).not.toBe(statSync(path.join(shared, rel)).ino);
            writeFileSync(path.join(wt, rel), 'rewritten by npm install\n');
            expect(readFileSync(path.join(shared, rel), 'utf8')).not.toContain('rewritten');
            expect(readFileSync(path.join(scratch, 'wt1', rel), 'utf8')).not.toContain('rewritten');
        }

        // The rest of the tree stays shared: only the files npm rewrites are broken out.
        expect(statSync(path.join(wt, 'node_modules/dep/index.js')).ino).toBe(
            statSync(path.join(shared, 'node_modules/dep/index.js')).ino,
        );
    });

    it('checks out an existing branch instead of failing on -b', () => {
        git(repo, 'branch', 'feature/existing', 'main');

        const wt = path.join(scratch, 'wtExisting');
        run([wt, 'feature/existing']);

        expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/existing');
    });

    it('refuses a start point for an existing branch, before creating anything', () => {
        git(repo, 'branch', 'feature/startless', 'main');
        const wt = path.join(scratch, 'wtStartless');

        expect(() => run([wt, 'feature/startless', 'main'])).toThrow(/start point would be ignored/);
        expect(existsSync(wt)).toBe(false);
    });

    it('resolves a relative path against INIT_CWD, the directory npm was started in', () => {
        const start = path.join(scratch, 'start');
        mkdirSync(start);
        run(['wtRelative', 'feature/relative'], { INIT_CWD: start });

        expect(git(path.join(start, 'wtRelative'), 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(
            'feature/relative',
        );
    });

    it('runs when its own path has a space, which import.meta.url percent-encodes', () => {
        const dir = path.join(scratch, 'with space');
        mkdirSync(dir);
        copyFileSync(script, path.join(dir, 'worktreeAdd.mjs'));

        const wt = path.join(scratch, 'wtSpace');
        execFileSync('node', [path.join(dir, 'worktreeAdd.mjs'), wt, 'feature/space'], {
            cwd: repo,
            env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, KS_INSTALL_ROOT: installRoot },
        });

        expect(existsSync(path.join(wt, 'node_modules/dep/index.js'))).toBe(true);
    });

    it('a failed install leaves no install behind, so nothing half-built is reused', () => {
        const other = path.join(scratch, 'wt3');
        const failing = path.join(scratch, 'repo2');

        execFileSync('git', ['clone', '-q', repo, failing]);
        writeFileSync(path.join(failing, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"x":{}}}\n');
        git(failing, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'new lock');

        expect(() =>
            execFileSync('node', [script, other, 'feature/three'], {
                cwd: failing,
                stdio: 'pipe',
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
                    KS_INSTALL_ROOT: installRoot,
                    KS_FAKE_NPM_LOG: npmLog,
                    KS_FAKE_NPM_FAIL: '1',
                },
            }),
        ).toThrow();

        // The half-made worktree and its new branch are gone, so a re-run of the same command can start clean.
        expect(existsSync(other)).toBe(false);
        expect(git(failing, 'branch', '--list', 'feature/three').trim()).toBe('');
        expect(git(failing, 'worktree', 'list', '--porcelain')).not.toContain(other);

        const failedHash = lockfileHash(Buffer.from('{"lockfileVersion":3,"packages":{"x":{}}}\n'));

        expect(existsSync(path.join(installRoot, failedHash))).toBe(false);
        expect(readdirSync(installRoot).filter((name) => name.startsWith('.tmp'))).toEqual([]);
    });

    it('refuses an install root on another filesystem before it adds anything', () => {
        const foreign = path.join('/dev/shm', `worktreeAdd-${process.pid}`);
        mkdirSync('/dev/shm', { recursive: true });
        const sameDevice = statSync('/dev/shm').dev === statSync(scratch).dev;
        const wt = path.join(scratch, 'wtForeign');

        try {
            if (sameDevice) {
                return;
            }

            expect(() => run([wt, 'feature/foreign'], { KS_INSTALL_ROOT: foreign })).toThrow();
            expect(existsSync(wt)).toBe(false);
            expect(git(repo, 'branch', '--list', 'feature/foreign').trim()).toBe('');
        } finally {
            rmSync(foreign, { recursive: true, force: true });
        }
    });

    it('prunes installs beyond the newest three but keeps the one a live worktree needs', () => {
        const live = lockfileHash(Buffer.from(lock));

        // Four stale installs, all older than the live one's timestamp window.
        for (const [index, name] of ['s1', 's2', 's3', 's4'].entries()) {
            const dir = path.join(installRoot, name);
            mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
            utimesSync(dir, new Date(1_000_000 + index), new Date(1_000_000 + index));
        }

        utimesSync(path.join(installRoot, live), new Date(500), new Date(500));

        // The oldest install of all belongs to a live worktree with its own lockfile: age alone would delete it.
        const protectedLock = '{"lockfileVersion":3,"packages":{"p":{}}}\n';
        const protectedWt = path.join(scratch, 'wtProtected');
        git(repo, 'worktree', 'add', '-q', '-b', 'feature/protected', protectedWt, 'main');
        writeFileSync(path.join(protectedWt, 'package-lock.json'), protectedLock);
        const kept = lockfileHash(Buffer.from(protectedLock));
        mkdirSync(path.join(installRoot, kept, 'node_modules'), { recursive: true });
        utimesSync(path.join(installRoot, kept), new Date(1), new Date(1));

        // Pruning renames a victim to `.tmp-trash-*` before it deletes it, so those folders are tmp: an old one is a
        // killed run's leftover and goes, a fresh one may be another run's work in progress and stays.
        mkdirSync(path.join(installRoot, '.tmp-trash-old-1'));
        utimesSync(path.join(installRoot, '.tmp-trash-old-1'), new Date(500), new Date(500));
        mkdirSync(path.join(installRoot, '.tmp-trash-fresh-1'));

        run([path.join(scratch, 'wt4'), 'feature/four', 'main']);

        const left = readdirSync(installRoot).sort();

        expect(left).toContain(live);
        expect(left).toContain(kept);
        expect(left).toContain('s4');
        expect(left).toContain('s3');
        expect(left).not.toContain('s2');
        expect(left).not.toContain('s1');
        expect(left).not.toContain('.tmp-trash-old-1');
        expect(left).toContain('.tmp-trash-fresh-1');
        expect(left.filter((name) => name.startsWith('.tmp-trash-') && name !== '.tmp-trash-fresh-1')).toEqual([]);
    });

    it('a prune that fails after the worktree is complete only warns, and the run succeeds', () => {
        for (const [index, name] of ['p1', 'p2', 'p3', 'p4'].entries()) {
            const dir = path.join(installRoot, name);
            mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
            utimesSync(dir, new Date(2_000 + index), new Date(2_000 + index));
        }

        // A read-only install root: the cache hit still links, but pruning cannot rename a victim out of the way.
        chmodSync(installRoot, 0o555);

        try {
            const wt = path.join(scratch, 'wtPruneFails');
            const result = spawnSync('node', [script, wt, 'feature/pruneFails', 'main'], {
                cwd: repo,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
                    KS_INSTALL_ROOT: installRoot,
                    KS_FAKE_NPM_LOG: npmLog,
                },
            });

            expect(result.status).toBe(0);
            expect(result.stderr).toContain('pruning old installs failed');
            expect(existsSync(path.join(wt, 'node_modules/dep/index.js'))).toBe(true);
        } finally {
            chmodSync(installRoot, 0o755);
        }
    });
});
