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
