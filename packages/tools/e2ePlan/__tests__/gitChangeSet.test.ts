import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtureRepo, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import { changedFiles, changedSince } from '../src/gitChangeSet.js';
import { snapshotTree } from '../src/worktreeSnapshot.js';

describe('changedFiles against a real repository', () => {
    let repo: FixtureRepo;
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8' }).trim();

    const write = (path: string, text: string): void => {
        mkdirSync(dirname(join(repo.root, path)), { recursive: true });
        writeFileSync(join(repo.root, path), text);
    };

    beforeEach(() => {
        repo = makeFixtureRepo({ 'keep.ts': 'a\n', 'old.ts': 'old file with enough text to be a rename\n'.repeat(5) });
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 'a@b.c');
        git('config', 'user.name', 'n');
        git('add', '.');
        git('commit', '-q', '-m', 'base');
        git('checkout', '-q', '-b', 'work');
    });
    afterEach(() => repo.remove());

    it('is empty on a clean branch', async () => {
        expect((await changedFiles(repo.root, 'main')).files).toEqual([]);
    });

    it('sees a committed change, a staged one, an edit, and an untracked file', async () => {
        write('committed.ts', 'x\n');
        git('add', 'committed.ts');
        git('commit', '-q', '-m', 'c');
        write('staged.ts', 'x\n');
        git('add', 'staged.ts');
        write('keep.ts', 'changed\n');
        write('untracked.ts', 'x\n');

        expect((await changedFiles(repo.root, 'main')).files).toEqual([
            'committed.ts',
            'keep.ts',
            'staged.ts',
            'untracked.ts',
        ]);
    });

    it('lists every file of an untracked directory, not the directory', async () => {
        write('fresh/one.ts', 'x\n');
        write('fresh/deep/two.ts', 'x\n');

        expect((await changedFiles(repo.root, 'main')).files).toEqual(['fresh/deep/two.ts', 'fresh/one.ts']);
    });

    it('does not list a file the repository ignores', async () => {
        write('.gitignore', 'ignored.log\n');
        write('ignored.log', 'x\n');

        expect((await changedFiles(repo.root, 'main')).files).toEqual(['.gitignore']);
    });

    it('compares against the merge base, not the tip of a base that moved on', async () => {
        git('checkout', '-q', 'main');
        write('onlyOnMain.ts', 'x\n');
        git('add', 'onlyOnMain.ts');
        git('commit', '-q', '-m', 'main moved');
        git('checkout', '-q', 'work');
        write('mine.ts', 'x\n');

        const result = await changedFiles(repo.root, 'main');

        expect(result.files).toEqual(['mine.ts']);
        expect(result.mergeBase).toMatch(/^[0-9a-f]{40}$/u);
    });

    it('lists both names of a rename', async () => {
        renameSync(join(repo.root, 'old.ts'), join(repo.root, 'new.ts'));
        git('add', '-A');

        expect((await changedFiles(repo.root, 'main')).files).toEqual(['new.ts', 'old.ts']);
    });

    it('returns the tree of the working tree it measured, for a stamp to name', async () => {
        write('mine.ts', 'x\n');

        expect((await changedFiles(repo.root, 'main')).tree).toBe(await snapshotTree(repo.root));
    });

    it('does not move the process working directory, which other work shares across an await', async () => {
        const before = process.cwd();
        const seen = new Set<string>();
        const watcher = setInterval(() => seen.add(process.cwd()), 1);

        try {
            await changedFiles(repo.root, 'main');
        } finally {
            clearInterval(watcher);
        }

        expect([...seen].filter((dir) => dir !== before)).toEqual([]);
    });

    it('measures from a recorded tree: only what changed since then', async () => {
        write('before.ts', 'x\n');
        const stamped = await snapshotTree(repo.root);

        write('after.ts', 'x\n');

        expect((await changedSince(repo.root, stamped)).files).toEqual(['after.ts']);
    });

    it('is empty when nothing changed since the recorded tree', async () => {
        write('before.ts', 'x\n');

        expect((await changedSince(repo.root, await snapshotTree(repo.root))).files).toEqual([]);
    });

    it('fails, naming the ref, when the base does not exist', async () => {
        await expect(changedFiles(repo.root, 'origin/nope')).rejects.toThrow(/origin\/nope/u);
        rmSync(join(repo.root, 'keep.ts'));
    });
});
