/**
 * The length a step offers to time. The index counts steps with text only, as the step walk does, so a blank step
 * before the step cannot hand it another step's length.
 */
import { describe, expect, it } from 'vitest';

import { stepOfferMs } from '../stepOfferMs.js';

const steps = [
    { stepNumber: 1, instruction: 'Chop.', timerSeconds: 60 },
    { stepNumber: 2, instruction: '   ', timerSeconds: 999 },
    { stepNumber: 3, instruction: 'Roast.', timerSeconds: 1200 },
    { stepNumber: 4, instruction: 'Rest.' },
    { stepNumber: 5, instruction: 'Serve.', timerSeconds: 0 },
];

describe('stepOfferMs', () => {
    it('reads the length of the step at the index among steps with text', () => {
        expect(stepOfferMs(steps, 0)).toBe(60_000);
        expect(stepOfferMs(steps, 1)).toBe(1_200_000);
    });

    it('offers nothing for a step with no length, a zero length or no such step', () => {
        expect(stepOfferMs(steps, 2)).toBeUndefined();
        expect(stepOfferMs(steps, 3)).toBeUndefined();
        expect(stepOfferMs(steps, 9)).toBeUndefined();
    });
});
