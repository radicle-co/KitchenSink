import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtureRepo, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import { resolveChange } from '../src/resolveChange.js';
import { settleStamp, stateRoot, type SettleInput } from '../src/stampRun.js';
import { stateRoot as storeStateRoot } from '../src/stampStore.js';
import { snapshotTree } from '../src/worktreeSnapshot.js';

describe('settleStamp: the end-of-run step both doors share', () => {
    let repo: FixtureRepo;
    let state: string;
    let lines: string[];
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8' }).trim();

    beforeEach(() => {
        repo = makeFixtureRepo({ 'keep.ts': 'a\n' });
        state = mkdtempSync(join(tmpdir(), 'settleStamp-'));
        lines = [];
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

    const input = async (over: Partial<SettleInput> = {}): Promise<SettleInput> => ({
        repo: repo.root,
        stateRoot: state,
        platform: 'android',
        start: { planTree: await snapshotTree(repo.root), previous: undefined },
        outcomes: { passed: 3, failed: 0, skipped: 0 },
        owed: [],
        recorderClean: true,
        log: (line) => lines.push(line),
        ...over,
    });

    const baseOf = async (platform: 'android' | 'web') =>
        (await resolveChange({ repo: repo.root, stateRoot: state, ci: false, platform })).base.kind;

    it('moves the stamp for a run that earned it, and says so', async () => {
        await settleStamp(await input());

        expect(await baseOf('android')).toBe('stamp');
        expect(lines).toEqual(['android green stamp moved to this run (owed: 0)']);
    });

    it('carries the owed specs into the stamp and prints them, whether or not the stamp moves', async () => {
        await settleStamp(await input({ owed: ['paidFeatureRoles.spec.ts'] }));
        await settleStamp(await input({ owed: ['b.spec.ts'], outcomes: { passed: 0, failed: 1, skipped: 0 } }));

        expect(lines).toContain('android owed: paidFeatureRoles.spec.ts');
        expect(lines).toContain('android owed: b.spec.ts');
        expect(lines).toContain('android green stamp moved to this run (owed: 1)');
    });

    it('does not move the stamp for a failing run, and gives the reason', async () => {
        await settleStamp(await input({ outcomes: { passed: 2, failed: 1, skipped: 0 } }));

        expect(await baseOf('android')).toBe('none');
        expect(lines.join('\n')).toMatch(/not moved \(.*failed or was skipped/u);
    });

    it('does not move the stamp when the recorder found a problem', async () => {
        await settleStamp(await input({ recorderClean: false }));

        expect(await baseOf('android')).toBe('none');
    });

    it('says the run left no report when there are no outcomes', async () => {
        await settleStamp(await input({ outcomes: undefined }));

        expect(await baseOf('android')).toBe('none');
        expect(lines).toEqual(['android green stamp not moved (the run left no report to count)']);
    });

    it('does nothing about the stamp when no start was kept, because a person chose the tests', async () => {
        await settleStamp(await input({ start: undefined }));

        expect(await baseOf('android')).toBe('none');
        expect(lines).toEqual([]);
    });

    it('never throws: a failure to record is a warning and the exit code stays the door’s', async () => {
        await expect(settleStamp(await input({ repo: join(state, 'not a repository') }))).resolves.toBeUndefined();

        expect(lines.join('\n')).toMatch(/warning: could not record the android green stamp/u);
    });

    it('keeps each platform’s stamp apart', async () => {
        await settleStamp(await input({ platform: 'web' }));

        expect(await baseOf('web')).toBe('stamp');
        expect(await baseOf('android')).toBe('none');
    });
});

describe('stateRoot, through the door module', () => {
    it('is the state home the stamp store uses, so a door never repeats the XDG rule', () => {
        expect(stateRoot).toBe(storeStateRoot);
        expect(stateRoot({ XDG_STATE_HOME: '/x' }, '/home/u')).toBe('/x/kitchensink');
    });
});
