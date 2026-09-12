/**
 * The admission ceiling (ADR-0053 §2; the owner's 2026-09-15 ruling "Up to 900", now for every source): ⌊0.9 ×
 * requests⌋, the same for both lanes. The top tenth of a declared limit is never spent.
 */
import { describe, expect, it } from 'vitest';

import { sourceCeiling } from '../sourceCeiling.js';

describe('sourceCeiling', () => {
    it.each([
        [1000, 900],
        [24, 21],
        [600, 540],
        [10, 9],
        [9, 8],
        [2, 1],
        [1, 0],
    ])('admits ⌊0.9 × %i⌋ = %i calls', (requests, ceiling) => {
        expect(sourceCeiling(requests)).toBe(ceiling);
    });

    it('is the largest whole number of calls at or under 90%, for every limit up to 100,000', () => {
        const wrong: number[] = [];

        for (let requests = 1; requests <= 100_000; requests += 1) {
            if (sourceCeiling(requests) * 10 > requests * 9 || (sourceCeiling(requests) + 1) * 10 <= requests * 9) {
                wrong.push(requests);
            }
        }

        expect(wrong).toEqual([]);
    });
});
