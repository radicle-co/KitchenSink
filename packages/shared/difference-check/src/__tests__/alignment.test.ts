/**
 * Measure L's engine: the length of the longest common subsequence, found bit-parallel (KTD-3). It is hand-rolled, so it
 * is held to a plain dynamic-programming oracle on random sequences, across the 32-bit word boundary.
 */
import { describe, expect, it } from 'vitest';

import { seededDraw } from '../__fixtures__/synthetic.js';
import { longestCommonSubsequence } from '../measures/alignment.js';

/** The textbook table: the oracle. Quadratic, so only for short sequences. */
function plainLcs(first: readonly string[], second: readonly string[]): number {
    let previous = new Array<number>(second.length + 1).fill(0);

    for (const left of first) {
        const row = [0];

        second.forEach((right, column) => {
            row.push(
                left === right ? (previous[column] ?? 0) + 1 : Math.max(previous[column + 1] ?? 0, row[column] ?? 0),
            );
        });
        previous = row;
    }

    return previous[second.length] ?? 0;
}

/** `length` tokens drawn from an alphabet of `alphabet` symbols. */
function sequence(draw: () => number, length: number, alphabet: number): string[] {
    return Array.from({ length }, () => `t${String(Math.floor(draw() * alphabet))}`);
}

describe('longestCommonSubsequence', () => {
    it('is 0 when either side is empty', () => {
        expect(longestCommonSubsequence([], ['a'])).toBe(0);
        expect(longestCommonSubsequence(['a'], [])).toBe(0);
        expect(longestCommonSubsequence([], [])).toBe(0);
    });

    it('is the length of identical sequences, and 0 for sequences with no token in common', () => {
        expect(longestCommonSubsequence(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(3);
        expect(longestCommonSubsequence(['a', 'b', 'c'], ['x', 'y', 'z'])).toBe(0);
    });

    it('keeps order: the same tokens reversed share only one', () => {
        expect(longestCommonSubsequence(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'])).toBe(1);
    });

    it('does not need the shared tokens to touch (a textbook pair)', () => {
        expect(longestCommonSubsequence('abcbdab'.split(''), 'bdcaba'.split(''))).toBe(4);
    });

    it('counts a repeated token once per place it can match', () => {
        expect(longestCommonSubsequence(['a', 'a', 'a'], ['a', 'a'])).toBe(2);
        expect(longestCommonSubsequence(['a', 'a'], ['a', 'a', 'a'])).toBe(2);
    });

    it('is symmetric', () => {
        const draw = seededDraw(7);
        const first = sequence(draw, 90, 6);
        const second = sequence(draw, 70, 6);

        expect(longestCommonSubsequence(first, second)).toBe(longestCommonSubsequence(second, first));
    });

    it.each([31, 32, 33, 63, 64, 65, 96, 97])(
        'matches the plain table when the baseline is %i tokens, on the edge of a 32-bit word',
        (length) => {
            const draw = seededDraw(length);

            for (let alphabet = 2; alphabet <= 50; alphabet += 8) {
                const baseline = sequence(draw, length, alphabet);
                const steps = sequence(draw, 80, alphabet);

                expect(longestCommonSubsequence(baseline, steps), `alphabet ${String(alphabet)}`).toBe(
                    plainLcs(baseline, steps),
                );
            }
        },
    );

    it('matches the plain table on 400 random pairs, lengths 0 to 200 and alphabets 2 to 50', () => {
        const draw = seededDraw(2026);

        for (let trial = 0; trial < 400; trial += 1) {
            const baseline = sequence(draw, Math.floor(draw() * 201), 2 + Math.floor(draw() * 49));
            const steps = sequence(draw, Math.floor(draw() * 201), 2 + Math.floor(draw() * 49));

            expect(longestCommonSubsequence(baseline, steps), `trial ${String(trial)}`).toBe(plainLcs(baseline, steps));
        }
    });
});
