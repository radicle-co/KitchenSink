import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { GOLDEN_CORPUS_STEPS } from '../__fixtures__/stepLinesGolden.js';
import { countCookableSteps, hasStepText } from '../cookability.js';
import { cookingStepsOf } from '../cookingSteps.js';
import { splitStepLines } from '../stepLines.js';
import { stepPlace } from '../place.js';

/**
 * `cookingStepsOf` — the recipe's steps as the cook walks them: each step with text, split into lines. A step
 * with no text is skipped (FR-033a).
 *
 * A blank or whitespace-only step is not a step for the cook. It is skipped, so the place, the track and Done count
 * only steps with text, and no 0-line step ever reaches the reducers. Order is the recipe's own.
 */

const step = (stepNumber: number, instruction: string) => ({ stepNumber, instruction });

describe('cookingStepsOf', () => {
    it('splits each step into its lines, in recipe order', () => {
        expect(
            cookingStepsOf([step(1, 'Heat the oil. Add the onion.'), step(2, 'Preheat the oven to 220°C.')]),
        ).toEqual([
            { stepNumber: 1, lines: ['Heat the oil.', 'Add the onion.'] },
            { stepNumber: 2, lines: ['Preheat the oven to 220°C.'] },
        ]);
    });

    it('[text, blank, text, text] gives 3 steps, and the second text step is Step 2 of 3', () => {
        const steps = cookingStepsOf([step(1, 'Mix.'), step(2, '   '), step(3, 'Bake.'), step(4, 'Serve.')]);

        expect(steps.map((s) => s.stepNumber)).toEqual([1, 3, 4]);
        expect(stepPlace(1, steps.length)).toMatchObject({ position: 2, total: 3 });
    });

    it('a recipe whose steps are all blank has no steps for the cook', () => {
        expect(cookingStepsOf([step(1, ''), step(2, '\n\t ')])).toEqual([]);
    });

    it('a recipe with no steps has none', () => {
        expect(cookingStepsOf([])).toEqual([]);
    });

    it('never yields a step with no lines, and keeps every step with text', () => {
        fc.assert(
            fc.property(fc.array(fc.oneof(fc.string(), fc.constantFrom('', ' ', '\n', 'Mix. Bake.'))), (texts) => {
                const steps = cookingStepsOf(texts.map((text, index) => step(index + 1, text)));

                for (const cookingStep of steps) {
                    expect(cookingStep.lines.length).toBeGreaterThan(0);
                }

                expect(steps).toHaveLength(texts.filter((text) => text.trim() !== '').length);
            }),
        );
    });

    it('counts exactly the steps countCookableSteps counts, for any text (one count)', () => {
        const text = fc.oneof(fc.string(), fc.constantFrom('', ' ', '\n\t', '!', 'Mix. Bake.', ' ?? '));

        fc.assert(
            fc.property(fc.array(text, { maxLength: 12 }), (texts) => {
                expect(cookingStepsOf(texts.map((t, index) => step(index + 1, t)))).toHaveLength(
                    countCookableSteps(texts),
                );
            }),
            { numRuns: 500 },
        );
    });

    it('counts the golden 1919 steps the same way countCookableSteps does', () => {
        const texts = GOLDEN_CORPUS_STEPS.map((golden) => golden.text);

        expect(cookingStepsOf(texts.map((t, index) => step(index + 1, t)))).toHaveLength(countCookableSteps(texts));
        expect(countCookableSteps(texts)).toBe(GOLDEN_CORPUS_STEPS.length);
    });

    /**
     * CookingStep's "never empty" rests on this: cookingStepsOf filters with hasStepText, then trusts the splitter.
     * The count property above cannot see a break here, because both of its sides use the same filter.
     */
    it('any text hasStepText accepts splits into at least one line, punctuation-only text included', () => {
        const text = fc.oneof(fc.string(), fc.constantFrom('!', '??', '...', '.', ' ! ', '\n?\n', 'Mix. !', '. Mix'));

        fc.assert(
            fc.property(text, (t) => {
                if (hasStepText(t)) {
                    expect(splitStepLines(t).length).toBeGreaterThan(0);
                }
            }),
            { numRuns: 1000 },
        );
        fc.assert(
            fc.property(fc.array(text, { maxLength: 8 }), (texts) => {
                for (const cookingStep of cookingStepsOf(texts.map((t, index) => step(index + 1, t)))) {
                    expect(cookingStep.lines.length).toBeGreaterThan(0);
                }
            }),
        );
    });
});
