/**
 * The cost bound (KTD-3, qse F-11, Q-L1): the check runs synchronously on the save path, so the measures must not be
 * quadratic in the text. The tripwire runs R and L directly on two independent sequences of about 70,000 tokens, four
 * times the body limit: bit-parallel about 1.5 x 10^8 word steps, a quadratic form about 4.9 x 10^9 cells. Its own
 * explicit timeout is the bound, so a changed default cannot hide a regression. No timing is asserted.
 */
import { describe, expect, it } from 'vitest';

import { seededDraw, synthWord, textOf } from '../__fixtures__/synthetic.js';
import { differenceCheckV1 } from '../differenceCheckV1.js';
import { longestCommonSubsequence } from '../measures/alignment.js';
import { longestSharedRun } from '../measures/measures.js';

/** `length` words drawn from the 4096 synthetic words. */
function words(seed: number, length: number): string[] {
    const draw = seededDraw(seed);

    return Array.from({ length }, () => synthWord(Math.floor(draw() * 4096)));
}

describe('the cost of the measures', () => {
    it('finishes R and L on two independent sequences of 70,000 tokens', { timeout: 5000 }, () => {
        const baseline = words(1, 70_000);
        const steps = words(2, 70_000);

        expect(longestSharedRun(baseline, steps)).toBeGreaterThanOrEqual(0);
        expect(longestCommonSubsequence(baseline, steps)).toBeGreaterThan(0);
    });

    it('finishes the whole check on a pair at the 100 kB body limit inside the default timeout', () => {
        const baseline = words(3, 17_000);
        const result = differenceCheckV1(textOf(baseline), textOf(words(4, 17_000)));

        expect(result.total).toBeGreaterThan(0);
        expect(result.alignTotal).toBe(17_000);
    });
});
