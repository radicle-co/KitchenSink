import { describe, expect, it } from 'vitest';

import {
    chooseBase,
    nextStamp,
    onEmptyOf,
    type BaseInput,
    type GreenStamp,
    type RunEvidence,
} from '../src/greenStamp.js';

const stamp: GreenStamp = {
    version: 1,
    platform: 'android',
    branch: 'work',
    tree: 'aaaa',
    head: 'h1',
    owed: ['sandboxOnly/a'],
    at: '2026-11-07T00:00:00.000Z',
};

const local = (over: Partial<BaseInput> = {}): BaseInput => ({
    ci: false,
    platform: 'android',
    branch: 'work',
    stamp,
    stampTreeExists: true,
    ...over,
});

describe('chooseBase', () => {
    it('uses a stamp on a local run with no explicit base', () => {
        expect(chooseBase(local())).toEqual({ kind: 'stamp', stamp });
    });

    it('lets an explicit base win over a stamp', () => {
        expect(chooseBase(local({ explicitBase: 'origin/main' }))).toEqual({ kind: 'ref', ref: 'origin/main' });
    });

    it('uses the PR base in CI even when a stamp exists', () => {
        expect(chooseBase(local({ ci: true }))).toEqual({ kind: 'ref', ref: 'origin/main' });
    });

    it('falls back to origin/main when the caller names no platform, so no stamp can apply', () => {
        expect(chooseBase(local({ platform: undefined }))).toEqual({ kind: 'ref', ref: 'origin/main' });
    });

    it('runs everything when there is no stamp', () => {
        expect(chooseBase(local({ stamp: undefined }))).toMatchObject({ kind: 'none' });
    });

    it('runs everything when the HEAD is detached, because no branch can key a stamp', () => {
        expect(chooseBase(local({ branch: undefined }))).toMatchObject({ kind: 'none' });
    });

    it('runs everything when the stamped tree no longer exists', () => {
        expect(chooseBase(local({ stampTreeExists: false }))).toMatchObject({ kind: 'none' });
    });

    it('ignores a stamp written for another platform or branch', () => {
        expect(chooseBase(local({ platform: 'web' }))).toMatchObject({ kind: 'none' });
        expect(chooseBase(local({ branch: 'other' }))).toMatchObject({ kind: 'none' });
    });
});

describe('onEmptyOf', () => {
    it('runs everything on an empty diff against a ref, which looks like a wrong base', () => {
        expect(onEmptyOf({ kind: 'ref', ref: 'origin/main' })).toBe('full');
    });

    it('runs nothing on an empty diff against a stamp, which means nothing changed since the green run', () => {
        expect(onEmptyOf({ kind: 'stamp', stamp })).toBe('nothing');
    });
});

const green: RunEvidence = {
    platform: 'android',
    branch: 'work',
    head: 'h2',
    planTree: 'bbbb',
    endTree: 'bbbb',
    outcomes: { passed: 5, failed: 0, skipped: 0 },
    recorderClean: true,
    previous: stamp,
    dropped: ['sandboxOnly/b', 'sandboxOnly/a'],
    now: '2026-11-07T01:00:00.000Z',
};

describe('nextStamp', () => {
    it('stamps the tree at plan time and records what THIS run could not run', () => {
        expect(nextStamp(green)).toEqual({
            version: 1,
            platform: 'android',
            branch: 'work',
            tree: 'bbbb',
            head: 'h2',
            owed: ['sandboxOnly/a', 'sandboxOnly/b'],
            at: '2026-11-07T01:00:00.000Z',
        });
    });

    it('does not carry the previous stamp’s owed flows: owed is a report of the last green run, not a ledger', () => {
        // Nothing clears a carried item, so carrying it would print a flow as owed after a run that did run it.
        expect(nextStamp({ ...green, dropped: [] })).toMatchObject({ owed: [] });
    });

    it('refuses on a failure', () => {
        expect(nextStamp({ ...green, outcomes: { passed: 4, failed: 1, skipped: 0 } })).toHaveProperty('refused');
    });

    it('refuses on a skip, which claims nothing', () => {
        expect(nextStamp({ ...green, outcomes: { passed: 4, failed: 0, skipped: 1 } })).toHaveProperty('refused');
    });

    it('refuses when the recorder found a problem', () => {
        expect(nextStamp({ ...green, recorderClean: false })).toHaveProperty('refused');
    });

    it('refuses when the tree changed during the run, because the pass proves the old tree', () => {
        expect(nextStamp({ ...green, endTree: 'cccc' })).toMatchObject({ refused: expect.stringMatching(/tree/u) });
    });

    it('refuses on a detached HEAD', () => {
        expect(nextStamp({ ...green, branch: undefined })).toHaveProperty('refused');
    });

    it('accepts a run that selected nothing, so a change to docs advances the stamp', () => {
        expect(nextStamp({ ...green, outcomes: { passed: 0, failed: 0, skipped: 0 } })).toMatchObject({
            tree: 'bbbb',
        });
    });
});
