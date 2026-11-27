/**
 * The step a timer belongs to, found by its digest (not its index) so an edit moves the timer with its step. Rows:
 * a blank step before the timer's step, a step edited after the timer started, another recipe, and no recipe.
 */
import { stepDigest } from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { makeCookingRecipe } from '../../__fixtures__/makeCookingRecipe.js';
import { timerStepOf } from '../timerStep.js';

const steps = (...instructions: string[]) => instructions.map((instruction, i) => ({ stepNumber: i + 1, instruction }));

const timerAt = (stepIndex: number, text: string, recipeId = 'r1') => ({
    recipeId,
    stepIndex,
    stepDigest: stepDigest(text),
});

describe('timerStepOf', () => {
    it('gives the 1-based place and the lines of the matched step', () => {
        const recipe = makeCookingRecipe({ steps: steps('Chop.', 'Roast 20 minutes.\nRest 10 minutes.') });

        expect(timerStepOf(timerAt(1, 'Roast 20 minutes.\nRest 10 minutes.'), recipe)).toEqual({
            number: 2,
            lines: ['Roast 20 minutes.', 'Rest 10 minutes.'],
        });
    });

    it('counts only steps with text: a blank step before does not move the place', () => {
        const recipe = makeCookingRecipe({ steps: steps('Chop.', '   ', 'Roast.') });

        expect(timerStepOf(timerAt(1, 'Roast.'), recipe)).toEqual({ number: 2, lines: ['Roast.'] });
    });

    it('follows its step when the recipe was edited and the step moved', () => {
        const recipe = makeCookingRecipe({ steps: steps('New first.', 'Chop.', 'Roast.') });

        expect(timerStepOf(timerAt(1, 'Roast.'), recipe)).toEqual({ number: 3, lines: ['Roast.'] });
    });

    it('keeps the stored place with no lines when its step text was edited away (no guess at another step)', () => {
        const recipe = makeCookingRecipe({ steps: steps('Chop.', 'Roast longer.') });

        expect(timerStepOf(timerAt(0, 'Roast.'), recipe)).toEqual({ number: 1, lines: [] });
    });

    it('gives no lines for a timer of another recipe, and never throws', () => {
        const recipe = makeCookingRecipe({ id: 'r2', steps: steps('Roast.') });

        expect(timerStepOf(timerAt(0, 'Roast.', 'r1'), recipe)).toEqual({ number: 1, lines: [] });
    });

    it('gives no lines with no recipe, and for a stored index past the end of an empty recipe', () => {
        expect(timerStepOf(timerAt(4, 'Roast.'), undefined)).toEqual({ number: 5, lines: [] });
        expect(timerStepOf(timerAt(4, 'Roast.'), makeCookingRecipe({ steps: [] }))).toEqual({ number: 5, lines: [] });
    });
});
