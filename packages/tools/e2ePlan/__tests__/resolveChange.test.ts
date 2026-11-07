import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtureRepo, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import type { GreenStamp } from '../src/greenStamp.js';
import { resolveChange, stampLocation } from '../src/resolveChange.js';
import { snapshotTree } from '../src/worktreeSnapshot.js';
import { writeStamp } from '../src/stampStore.js';

describe('resolveChange against a real repository', () => {
    let repo: FixtureRepo;
    let state: string;
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8' }).trim();
    const write = (path: string, text: string): void => writeFileSync(join(repo.root, path), text);
    const local = { ci: false, platform: 'android' } as const;

    beforeEach(() => {
        repo = makeFixtureRepo({ 'keep.ts': 'a\n' });
        state = mkdtempSync(join(tmpdir(), 'resolveChange-'));
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 'a@b.c');
        git('config', 'user.name', 'n');
        git('add', '.');
        git('commit', '-q', '-m', 'base');
        git('checkout', '-q', '-b', 'work');
    });
    afterEach(() => {
        repo.remove();
        rmSync(state, { recursive: true, force: true });
    });

    const stampNow = async (over: Partial<GreenStamp> = {}): Promise<GreenStamp> => {
        const stamp: GreenStamp = {
            version: 1,
            platform: 'android',
            branch: 'work',
            tree: await snapshotTree(repo.root),
            head: git('rev-parse', 'HEAD'),
            owed: [],
            at: '2026-11-07T00:00:00.000Z',
            ...over,
        };

        writeStamp(await stampLocation(repo.root, state, 'work', 'android'), stamp, undefined);

        return stamp;
    };

    it('with no stamp, has no base and lists no files, but still measures the tree so the run can stamp itself', async () => {
        const result = await resolveChange({ repo: repo.root, stateRoot: state, ...local });

        expect(result.base.kind).toBe('none');
        expect(result.files).toEqual([]);
        expect(result.tree).toBe(await snapshotTree(repo.root));
    });

    it('with a stamp and no change, lists nothing and keeps the stamp as the base', async () => {
        const stamp = await stampNow();
        const result = await resolveChange({ repo: repo.root, stateRoot: state, ...local });

        expect(result.base).toEqual({ kind: 'stamp', stamp });
        expect(result.files).toEqual([]);
        expect(result.from).toBe(stamp.tree);
    });

    it('with a stamp, lists only what changed since it, not what the branch changed since main', async () => {
        write('before.ts', 'x\n');
        await stampNow();
        write('after.ts', 'x\n');

        expect((await resolveChange({ repo: repo.root, stateRoot: state, ...local })).files).toEqual(['after.ts']);
    });

    it('with an explicit base, ignores the stamp and measures from the merge base', async () => {
        const stamp = await stampNow();

        write('mine.ts', 'x\n');

        const result = await resolveChange({ repo: repo.root, stateRoot: state, ...local, explicitBase: 'main' });

        expect(result.base).toEqual({ kind: 'ref', ref: 'main' });
        expect(result.previous).toEqual(stamp);
        expect(result.files).toEqual(['mine.ts']);
        expect(result.from).toBe(git('merge-base', 'HEAD', 'main'));
    });

    it('in CI, ignores the stamp and measures from origin/main', async () => {
        await stampNow();

        await expect(
            resolveChange({ repo: repo.root, stateRoot: state, ci: true, platform: 'android' }),
        ).rejects.toThrow(/origin\/main/u);
    });

    it('with a stamp whose tree is gone, has no base', async () => {
        await stampNow({ tree: '0123456789012345678901234567890123456789' });

        expect((await resolveChange({ repo: repo.root, stateRoot: state, ...local })).base.kind).toBe('none');
    });

    it('with a stamp of another platform, has no base', async () => {
        await stampNow();

        expect((await resolveChange({ repo: repo.root, stateRoot: state, ci: false, platform: 'ios' })).base.kind).toBe(
            'none',
        );
    });
});
