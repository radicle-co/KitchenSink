/**
 * The admission ceiling (ADR-0053 §2; the owner's 2026-09-15 ruling "Up to 900", now for every source): ⌊0.9 ×
 * requests⌋. The top tenth of a declared limit is never spent. The worker lane stops earlier, at its share of that
 * ceiling (owner, 2026-10-02), so the rest of the window is kept for calls a cook is waiting on.
 */
import { describe, expect, it } from 'vitest';

import { sourceCeiling, WORKER_WINDOW_SHARE, workerCeiling } from '../sourceCeiling.js';

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

describe('workerCeiling', () => {
    // Two thirds, rounded down: 13 and 2 are where rounding up or to nearest would hand the worker one call more.
    it.each([
        [900, 600],
        [13, 8],
        [14, 9],
        [9, 6],
        [2, 1],
        [1, 0],
        [0, 0],
    ])('lets the worker spend ⌊⅔ × %i⌋ = %i calls of the window', (ceiling, share) => {
        expect(workerCeiling(ceiling)).toBe(share);
    });

    it('is the largest whole number of calls at or under the share, for every ceiling up to 100,000', () => {
        const { numerator, denominator } = WORKER_WINDOW_SHARE;
        const wrong: number[] = [];

        for (let ceiling = 0; ceiling <= 100_000; ceiling += 1) {
            const share = workerCeiling(ceiling);

            if (share * denominator > ceiling * numerator || (share + 1) * denominator <= ceiling * numerator) {
                wrong.push(ceiling);
            }
        }

        expect(wrong).toEqual([]);
    });
});
