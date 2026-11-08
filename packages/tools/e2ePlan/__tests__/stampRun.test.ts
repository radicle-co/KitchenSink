import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtureRepo, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import { resolveChange } from '../src/resolveChange.js';
import { recordGreenRun, type RecordInput } from '../src/stampRun.js';
import { snapshotTree } from '../src/worktreeSnapshot.js';

describe('recordGreenRun against a real repository', () => {
    let repo: FixtureRepo;
    let state: string;
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8' }).trim();

    beforeEach(() => {
        repo = makeFixtureRepo({ 'keep.ts': 'a\n' });
        state = mkdtempSync(join(tmpdir(), 'stampRun-'));
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

    const input = async (over: Partial<RecordInput> = {}): Promise<RecordInput> => ({
        repo: repo.root,
        stateRoot: state,
        platform: 'web',
        planTree: await snapshotTree(repo.root),
        selectedBy: 'selector',
        outcomes: { passed: 3, failed: 0, skipped: 0 },
        recorderClean: true,
        dropped: [],
        previous: undefined,
        now: '2026-11-07T00:00:00.000Z',
        ...over,
    });

    it('writes a stamp that the next run then measures from, so an unchanged tree selects nothing', async () => {
        const result = await recordGreenRun(await input());

        expect(result.kind).toBe('written');

        const next = await resolveChange({ repo: repo.root, stateRoot: state, ci: false, platform: 'web' });

        expect(next.base.kind).toBe('stamp');
        expect(next.files).toEqual([]);
    });

    it('names the tree at plan time, so a change made during the run is still owed', async () => {
        const planTree = await snapshotTree(repo.root);

        writeFileSync(join(repo.root, 'late.ts'), 'x\n');

        expect(await recordGreenRun(await input({ planTree }))).toMatchObject({ kind: 'refused' });
    });

    it('writes nothing when a test failed', async () => {
        expect(await recordGreenRun(await input({ outcomes: { passed: 2, failed: 1, skipped: 0 } }))).toMatchObject({
            kind: 'refused',
        });
        expect((await resolveChange({ repo: repo.root, stateRoot: state, ci: false, platform: 'web' })).base.kind).toBe(
            'none',
        );
    });

    it('reports a conflict when another run moved the stamp first, and keeps theirs', async () => {
        const slow = await input();
        const quick = await input({ dropped: ['quick'] });

        expect((await recordGreenRun(quick)).kind).toBe('written');
        expect((await recordGreenRun(slow)).kind).toBe('conflict');
        expect(
            (await resolveChange({ repo: repo.root, stateRoot: state, ci: false, platform: 'web' })).base,
        ).toMatchObject({
            stamp: { owed: ['quick'] },
        });
    });

    it('records only the owed flows of the run that wrote the stamp', async () => {
        const first = await recordGreenRun(await input({ dropped: ['a/sandboxOnly'] }));

        writeFileSync(join(repo.root, 'more.ts'), 'x\n');

        const result = await recordGreenRun(
            await input({ dropped: ['b/sandboxOnly'], previous: first.kind === 'written' ? first.stamp : undefined }),
        );

        expect(result).toMatchObject({ kind: 'written', stamp: { owed: ['b/sandboxOnly'] } });
    });
});
