/**
 * "The baseline only falls" means: no file's count is ever above the LOWEST count any version of the baseline in this
 * history recorded for it. Comparing only with the first version, or only with main, lets a count that fell be raised
 * back on a long-lived branch. A file absent from a version counts 0 there, so a file absent from the first version can
 * never appear, and a file that fell to zero can never come back.
 *
 * One rise is allowed: a recount. The current detector reads the file as it stood at the version that holds the lowest
 * count; if that source already holds the new count, the detector learned a shape and no styling was added. A file
 * absent there, or a rise beyond what its old source holds, is new styling.
 */
import { describe, expect, it } from 'vitest';

import { raisedAgainst, type BaselineVersion } from './ratchetBaseline.js';

interface Baseline {
    readonly files: Readonly<Record<string, number>>;
}

/** Newest first, as `git log` lists them. */
const history: readonly BaselineVersion<Baseline>[] = [
    { revision: 'r2', baseline: { files: { 'a.tsx': 2, 'b.tsx': 3, 'd.tsx': 1 } } },
    { revision: 'r1', baseline: { files: { 'a.tsx': 2, 'b.tsx': 3, 'c.tsx': 1, 'd.tsx': 4 } } },
];

/** The detector counts one use per line that says `use`. */
const recount = (_file: string, source: string): number => source.split('\n').filter((line) => line === 'use').length;

const sources: Readonly<Record<string, string>> = {
    'r2:a.tsx': 'use\nuse\nuse\nuse',
    'r2:b.tsx': 'use\nuse\nuse',
    'r2:d.tsx': 'use',
};

const sourceAt = (revision: string, file: string): string | undefined => sources[`${revision}:${file}`];

function raised(files: Readonly<Record<string, number>>): string[] {
    return raisedAgainst(history, [[files, (baseline) => baseline.files, recount]], sourceAt);
}

describe('raisedAgainst', () => {
    it('passes a baseline that only fell', () => {
        expect(raised({ 'a.tsx': 1, 'b.tsx': 3, 'd.tsx': 1 })).toEqual([]);
    });

    it('allows a rise the current detector finds in the file at its lowest version (a recount)', () => {
        expect(raised({ 'a.tsx': 4, 'b.tsx': 3, 'd.tsx': 1 })).toEqual([]);
    });

    it('refuses a rise beyond what the old source holds (styling added)', () => {
        expect(raised({ 'a.tsx': 2, 'b.tsx': 4, 'd.tsx': 1 })).toEqual([
            'b.tsx: 4 > 3 (lowest at r2, where the current detector counts 3)',
        ]);
    });

    it('refuses a count raised back after it fell on the branch', () => {
        expect(raised({ 'a.tsx': 2, 'b.tsx': 3, 'd.tsx': 4 })).toEqual([
            'd.tsx: 4 > 1 (lowest at r2, where the current detector counts 1)',
        ]);
    });

    it('refuses a file that fell to zero coming back', () => {
        expect(raised({ 'a.tsx': 2, 'b.tsx': 3, 'c.tsx': 1, 'd.tsx': 1 })).toEqual([
            'c.tsx: 1 > 0 (lowest at r2, where the file did not exist)',
        ]);
    });

    it('refuses a path no version ever had', () => {
        expect(raised({ 'a.tsx': 2, 'b.tsx': 3, 'd.tsx': 1, 'e.tsx': 1 })).toEqual([
            'e.tsx: 1 > 0 (lowest at r2, where the file did not exist)',
        ]);
    });

    it('refuses a rise when the map has no detector to recount with', () => {
        expect(raisedAgainst(history, [[{ 'a.tsx': 4 }, (baseline) => baseline.files]], sourceAt)).toEqual([
            'a.tsx: 4 > 2 (lowest at r2)',
        ]);
    });
});
