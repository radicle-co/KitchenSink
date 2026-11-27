import { describe, expect, it } from 'vitest';

import { cookingStepsOf } from '../cookingSteps.js';
import { stepDigest } from '../stepDigest.js';
import { stepDigestsOf } from '../stepDigestsOf.js';

/**
 * `stepDigestsOf` is the one rule for "the digest of each step the cook walks": the reader (which step a timer is on)
 * and the writer (the digest stored when a timer starts) both call it, so they cannot drift apart.
 */
const step = (stepNumber: number, instruction: string) => ({ stepNumber, instruction });

describe('stepDigestsOf', () => {
    it('gives one digest of the raw instruction per step with text, in the same order and count as cookingStepsOf', () => {
        const steps = [step(1, 'Chop.'), step(2, '   '), step(3, 'Roast\nfor an hour.')];

        const digests = stepDigestsOf(steps);

        expect(digests).toHaveLength(cookingStepsOf(steps).length);
        expect(digests).toEqual([stepDigest('Chop.'), stepDigest('Roast\nfor an hour.')]);
    });

    it('is empty for no steps', () => {
        expect(stepDigestsOf([])).toEqual([]);
    });
});
