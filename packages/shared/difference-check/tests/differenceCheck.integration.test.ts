import { describe, expect, it } from 'vitest';

import {
    baselineQualifiesV1,
    differenceCheckV1,
    DifferenceCheckError,
    FROZEN_UNICODE_VERSION,
    isDifferenceCheckError,
    stepsTextOf,
} from '@kitchensink/difference-check';

/**
 * The difference check as a consumer sees it: through its package name, over the real stemmer and the generated
 * confusables table. A mis-pointed `exports` entry, or a missing generated file, fails every test here while the unit
 * tests (which import modules by relative path) stay green.
 */
const BASE_STEPS = [
    { instruction: 'Heat the olive oil in a heavy pan over a medium flame.' },
    { instruction: 'Add the chopped onion and cook it slowly until it turns soft and golden, about eight minutes.' },
    {
        instruction:
            'Stir in two cloves of garlic and a tin of tomatoes, then let the sauce simmer gently for twenty minutes.',
    },
    { instruction: 'Season with salt and black pepper, tear in the basil leaves and serve over hot pasta.' },
];

const REWRITE_STEPS = [
    { instruction: 'Warm a splash of oil in your widest saucepan.' },
    {
        instruction:
            'Soften a diced onion without letting it colour, then add crushed garlic and canned plum tomatoes.',
    },
    {
        instruction:
            'Leave everything bubbling quietly, stirring now and then, and finish with torn basil and seasoning.',
    },
];

describe('difference check through the package export', () => {
    const baseline = stepsTextOf(BASE_STEPS);

    it('passes an independent rewrite and fails the baseline itself', () => {
        const rewrite = differenceCheckV1(baseline, stepsTextOf(REWRITE_STEPS));
        const same = differenceCheckV1(baseline, baseline);

        expect({ version: rewrite.version, pass: rewrite.pass }).toEqual({ version: 'v1', pass: true });
        expect(same.pass).toBe(false);
        expect(same.kept).toBe(same.total);
    });

    it('accepts a baseline of at least 20 shingles and refuses a short one', () => {
        expect(baselineQualifiesV1(baseline)).toBe(true);
        expect(baselineQualifiesV1('Boil the eggs for nine minutes.')).toBe(false);
    });

    it('treats a foreign Unicode runtime as an error the caller can recognise', () => {
        const foreign = { unicode: '16.0' };

        expect(() => differenceCheckV1(baseline, baseline, foreign)).toThrow(DifferenceCheckError);
        expect(() => baselineQualifiesV1(baseline, foreign)).toThrow(DifferenceCheckError);

        try {
            baselineQualifiesV1(baseline, foreign);
            expect.unreachable('the foreign runtime must throw');
        } catch (error) {
            expect(isDifferenceCheckError(error)).toBe(true);
            expect(FROZEN_UNICODE_VERSION).toBe('17.0');
        }
    });

    it('joins steps one per line, as the stored baseline is built', () => {
        expect(stepsTextOf(REWRITE_STEPS).split('\n')).toHaveLength(REWRITE_STEPS.length);
    });
});
