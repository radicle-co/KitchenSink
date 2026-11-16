// @vitest-environment node
/**
 * The add flow of `scripts/worktreeAdd.mjs` on a throwaway git repository with a tiny lockfile and a fake `npm` on
 * `PATH` that "installs" one root package and one workspace package.
 *
 * What a mock of `git` or `fs` could not prove, and this does: the worktree really exists, its `node_modules` really
 * is hard-linked (same inode) to the shared install, a second worktree on the same lockfile runs NO install, a killed
 * install leaves nothing reusable, and an old install is pruned while the one a live worktree needs stays.
 */
import { execFileSync } from 'node:child_process';
import {
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
    });

    it('a second worktree on the same lockfile reuses the install and runs no npm', () => {
        const wt = path.join(scratch, 'wt2');
        run([wt, 'feature/two', 'main']);

        expect(existsSync(path.join(wt, 'node_modules/dep/index.js'))).toBe(true);
        expect(existsSync(path.join(wt, 'packages/a/node_modules/inner/index.js'))).toBe(true);
        expect(npmCalls()).toBe(1);
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

        const failedHash = lockfileHash(Buffer.from('{"lockfileVersion":3,"packages":{"x":{}}}\n'));

        expect(existsSync(path.join(installRoot, failedHash))).toBe(false);
        expect(readdirSync(installRoot).filter((name) => name.startsWith('.tmp'))).toEqual([]);
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

        run([path.join(scratch, 'wt4'), 'feature/four', 'main']);

        const left = readdirSync(installRoot).sort();

        expect(left).toContain(live);
        expect(left).toContain('s4');
        expect(left).toContain('s3');
        expect(left).not.toContain('s2');
        expect(left).not.toContain('s1');
    });
});
