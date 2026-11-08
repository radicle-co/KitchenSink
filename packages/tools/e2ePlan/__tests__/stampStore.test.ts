import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GreenStamp } from '../src/greenStamp.js';
import { stampFile, stateRoot, writeStamp, readStamp } from '../src/stampStore.js';

const stamp = (tree: string): GreenStamp => ({
    version: 1,
    platform: 'web',
    branch: 'chore/work',
    tree,
    head: 'h',
    owed: [],
    at: '2026-11-07T00:00:00.000Z',
});

describe('stampStore', () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'stampStore-'));
        file = stampFile(dir, 'repoKey', 'chore/work', 'web');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('keeps one file per repo, branch and platform, with no path climbing from a branch name', () => {
        expect(file).toBe(join(dir, 'e2eGreen', 'repoKey', 'chore%2Fwork', 'web.json'));
        expect(stampFile(dir, 'r', '../../x', 'web').startsWith(join(dir, 'e2eGreen', 'r'))).toBe(true);
    });

    it('reads nothing when there is no file', () => {
        expect(readStamp(file)).toBeUndefined();
    });

    it('writes a first stamp when none was expected, and reads it back', () => {
        expect(writeStamp(file, stamp('t1'), undefined)).toBe('written');
        expect(readStamp(file)).toEqual(stamp('t1'));
    });

    it('replaces the stamp it expected', () => {
        writeStamp(file, stamp('t1'), undefined);

        expect(writeStamp(file, stamp('t2'), stamp('t1'))).toBe('written');
        expect(readStamp(file)?.tree).toBe('t2');
    });

    it('refuses to replace a stamp another run wrote since this run started', () => {
        writeStamp(file, stamp('t1'), undefined);
        writeStamp(file, stamp('t2'), stamp('t1'));

        expect(writeStamp(file, stamp('t3'), stamp('t1'))).toBe('conflict');
        expect(readStamp(file)?.tree).toBe('t2');
    });

    it('names a stamp by its tree and its time, so a difference in the other fields is not a conflict', () => {
        writeStamp(file, stamp('t1'), undefined);

        const sameStamp = { ...stamp('t1'), head: 'another head', owed: ['x'] };

        expect(writeStamp(file, stamp('t2'), sameStamp)).toBe('written');
    });

    it('treats the same tree at another time as another stamp', () => {
        writeStamp(file, stamp('t1'), undefined);

        expect(writeStamp(file, stamp('t2'), { ...stamp('t1'), at: '2026-11-08T00:00:00.000Z' })).toBe('conflict');
    });

    it('refuses a first write when a stamp appeared meanwhile', () => {
        writeStamp(file, stamp('t1'), undefined);

        expect(writeStamp(file, stamp('t2'), undefined)).toBe('conflict');
    });

    it('treats a corrupt file as no stamp, and lets a run replace it', () => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, '{not json');

        expect(readStamp(file)).toBeUndefined();
        expect(writeStamp(file, stamp('t1'), undefined)).toBe('written');
    });

    it('treats a well-formed JSON of the wrong shape as no stamp', () => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ ...stamp('t1'), version: 2 }));

        expect(readStamp(file)).toBeUndefined();
    });

    it.each([
        ['an owed list that holds a number', { owed: [1] }],
        ['a platform nobody runs', { platform: 'tv' }],
        ['a missing tree', { tree: undefined }],
        ['a tree that is a number', { tree: 7 }],
    ])('treats a stamp with %s as no stamp', (_name, change) => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ ...stamp('t1'), ...change }));

        expect(readStamp(file)).toBeUndefined();
    });

    it('leaves no temporary file behind', () => {
        writeStamp(file, stamp('t1'), undefined);

        expect(readdirSync(dirname(file))).toEqual(['web.json']);
    });
});

describe('stateRoot', () => {
    it('honours XDG_STATE_HOME, and falls back to ~/.local/state/kitchensink', () => {
        expect(stateRoot({ XDG_STATE_HOME: '/x' }, '/home/u')).toBe('/x/kitchensink');
        expect(stateRoot({}, '/home/u')).toBe('/home/u/.local/state/kitchensink');
    });
});
