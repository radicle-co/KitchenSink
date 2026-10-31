/**
 * The "baseline only falls" rule must tell two raises apart: a DETECTOR that now sees more in code that already
 * existed (a recount, which is allowed), and new uses added to the code (which are not). It does so by running the
 * current detector over each raised file as it stood at the reference: if that old source already holds the new
 * count, the rise is a recount. A file absent at the reference, or one whose old source counts lower, is new styling.
 */
import { describe, expect, it } from 'vitest';

import { raisedAgainst, type Reference } from './ratchetBaseline.js';

interface Baseline {
    readonly files: Readonly<Record<string, number>>;
}

const reference: Reference<Baseline> = { source: 'origin/main', baseline: { files: { 'a.tsx': 2, 'b.tsx': 3 } } };

/** The detector counts one use per line that says `use`. */
const recount = (_file: string, source: string): number => source.split('\n').filter((line) => line === 'use').length;

const sources: Readonly<Record<string, string>> = {
    'origin/main:a.tsx': 'use\nuse\nuse\nuse',
    'origin/main:b.tsx': 'use\nuse\nuse',
};

const sourceAt = (revision: string, file: string): string | undefined => sources[`${revision}:${file}`];

function raised(files: Readonly<Record<string, number>>): string[] {
    return raisedAgainst(reference, [[files, (baseline) => baseline.files, recount]], sourceAt);
}

describe('raisedAgainst', () => {
    it('passes a baseline that only fell', () => {
        expect(raised({ 'a.tsx': 1, 'b.tsx': 3 })).toEqual([]);
    });

    it('allows a rise the current detector finds in the file as it stood at the reference (a recount)', () => {
        expect(raised({ 'a.tsx': 4, 'b.tsx': 3 })).toEqual([]);
    });

    it('refuses a rise beyond what the old source holds (styling added)', () => {
        expect(raised({ 'a.tsx': 2, 'b.tsx': 4 })).toEqual([
            'b.tsx: 4 > 3 (the reference is origin/main, where the current detector counts 3)',
        ]);
    });

    it('refuses a path the reference did not have', () => {
        expect(raised({ 'a.tsx': 2, 'b.tsx': 3, 'c.tsx': 1 })).toEqual([
            'c.tsx: 1 > 0 (the reference is origin/main, where the file did not exist)',
        ]);
    });

    it('refuses a rise when the map has no detector to recount with', () => {
        expect(raisedAgainst(reference, [[{ 'a.tsx': 4 }, (baseline) => baseline.files]], sourceAt)).toEqual([
            'a.tsx: 4 > 2 (the reference is origin/main)',
        ]);
    });
});
