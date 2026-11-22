/**
 * The three measures over normalised tokens (KTD-3): A (kept three-token shingles), R (the longest shared run) and F
 * (new stemmed words).
 */
import { describe, expect, it } from 'vitest';

import { NUMBER_TOKEN, UNIT_TOKEN } from '../normalise/foldQuantities.js';
import { keptShingles, longestSharedRun, newWordCount, shinglesOf } from '../measures/measures.js';
import { synthWords } from '../__fixtures__/synthetic.js';

describe('shinglesOf', () => {
    it('answers the distinct windows of the size', () => {
        expect(shinglesOf(['a', 'b', 'c', 'd'], 3).size).toBe(2);
        expect(shinglesOf(['a', 'b', 'a', 'b', 'a'], 2).size).toBe(2);
    });

    it('answers nothing for fewer tokens than the size', () => {
        expect(shinglesOf(['a', 'b'], 3).size).toBe(0);
        expect(shinglesOf([], 3).size).toBe(0);
    });

    it('keeps two different windows apart even when their tokens join to the same text', () => {
        expect(shinglesOf(['ab', 'c', 'd'], 3)).not.toEqual(shinglesOf(['a', 'bc', 'd'], 3));
    });
});

describe('keptShingles', () => {
    const baseline = synthWords(30);

    it('counts the baseline shingles found in the new text, over the distinct baseline shingles', () => {
        expect(keptShingles(baseline, baseline.slice(0, 10))).toEqual({ kept: 8, total: 28 });
    });

    it('counts a repeated baseline shingle once', () => {
        const repeating = ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'];

        expect(keptShingles(repeating, repeating)).toEqual({ kept: 3, total: 3 });
    });

    it('is nothing kept of an empty text, and total 0 for an empty baseline', () => {
        expect(keptShingles(baseline, [])).toEqual({ kept: 0, total: 28 });
        expect(keptShingles([], baseline)).toEqual({ kept: 0, total: 0 });
    });
});

describe('longestSharedRun', () => {
    const baseline = synthWords(60);

    it.each([0, 1, 2, 8, 9, 20, 40])('finds a shared run of %i tokens', (length) => {
        const fresh = synthWords(60, 500);
        const text = [...fresh.slice(0, 10), ...baseline.slice(5, 5 + length), ...fresh.slice(10, 20)];

        expect(longestSharedRun(baseline, text)).toBe(length);
    });

    it('answers the longest of several runs', () => {
        const fresh = synthWords(60, 500);
        const text = [
            ...baseline.slice(0, 4),
            fresh[0] ?? '',
            ...baseline.slice(10, 17),
            fresh[1] ?? '',
            ...baseline.slice(30, 33),
        ];

        expect(longestSharedRun(baseline, text)).toBe(7);
    });

    it('is capped at 64, so a copy of a long text still answers in bounded work', () => {
        const long = synthWords(300);

        expect(longestSharedRun(long, long)).toBe(64);
    });

    it('is zero for an empty side', () => {
        expect(longestSharedRun([], baseline)).toBe(0);
        expect(longestSharedRun(baseline, [])).toBe(0);
    });
});

describe('newWordCount', () => {
    it('counts the distinct words of the new text that are not in the baseline', () => {
        expect(newWordCount(['a', 'b', 'c'], ['c', 'd', 'd', 'e'])).toBe(2);
    });

    it('does not count a number or a unit, which is how a quantity-only edit adds no word', () => {
        expect(newWordCount(['a', 'b'], [NUMBER_TOKEN, UNIT_TOKEN, 'a'])).toBe(0);
    });

    it('is the whole vocabulary of the new text for an empty baseline', () => {
        expect(newWordCount([], ['a', 'b', 'a'])).toBe(2);
    });
});
