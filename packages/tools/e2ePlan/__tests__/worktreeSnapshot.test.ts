import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtureRepo, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import { changedBetween, snapshotTree, treeExists } from '../src/worktreeSnapshot.js';

describe('worktreeSnapshot against a real repository', () => {
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
    });
    afterEach(() => repo.remove());

    it('equals the tree of HEAD on a clean checkout', async () => {
        expect(await snapshotTree(repo.root)).toBe(git('rev-parse', 'HEAD^{tree}'));
    });

    it('is the same twice in a row', async () => {
        write('new.ts', 'x\n');

        expect(await snapshotTree(repo.root)).toBe(await snapshotTree(repo.root));
    });

    it('leaves the index exactly as it was, so a person staging files is not disturbed', async () => {
        write('untracked.ts', 'x\n');
        const before = readFileSync(join(repo.root, '.git', 'index'));

        await snapshotTree(repo.root);

        expect(readFileSync(join(repo.root, '.git', 'index')).equals(before)).toBe(true);
        expect(git('status', '--porcelain')).toBe('?? untracked.ts');
    });

    it('holds untracked files and leaves out ignored ones', async () => {
        write('.gitignore', 'ignored.log\n');
        write('ignored.log', 'x\n');
        write('fresh/one.ts', 'x\n');
        const tree = await snapshotTree(repo.root);

        expect(await changedBetween(repo.root, 'HEAD', tree)).toEqual(['.gitignore', 'fresh/one.ts']);
    });

    it('lists both names of a rename, and a path with spaces whole', async () => {
        renameSync(join(repo.root, 'old.ts'), join(repo.root, 'a new name.ts'));
        const tree = await snapshotTree(repo.root);

        expect(await changedBetween(repo.root, 'HEAD', tree)).toEqual(['a new name.ts', 'old.ts']);
    });

    it('lists a deletion', async () => {
        git('rm', '-q', 'keep.ts');

        expect(await changedBetween(repo.root, 'HEAD', await snapshotTree(repo.root))).toEqual(['keep.ts']);
    });

    it('is empty between a tree and itself', async () => {
        const tree = await snapshotTree(repo.root);

        expect(await changedBetween(repo.root, tree, tree)).toEqual([]);
    });

    it('knows whether a tree object exists', async () => {
        expect(await treeExists(repo.root, await snapshotTree(repo.root))).toBe(true);
        expect(await treeExists(repo.root, '0123456789012345678901234567890123456789')).toBe(false);
    });
});
