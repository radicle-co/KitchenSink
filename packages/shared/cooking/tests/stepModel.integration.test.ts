import { RecipeStatus, recipeStepSchema } from '@kitchensink/recipe-core';
import type { RecipeStep } from '@kitchensink/recipe-core';
import {
    cookLinkOutcome,
    cookingStepsOf,
    countCookableSteps,
    isCookable,
    isInvalidLineIndexError,
    isInvalidStepIndexError,
    linePlace,
    stepPlace,
} from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

/**
 * The step model through the package's PUBLIC surface: the `exports` map and its barrel, with recipe steps parsed by
 * recipe-core's own zod schema. Nothing is mocked. The unit tier imports each module by path, so only this tier fails
 * when the barrel stops exporting something or the seam with recipe-core changes shape. It also pins that the entry
 * rule and the walk agree: the count `isCookable` reads is the count `stepPlace` walks, with a blank step skipped by
 * both, and the line count `linePlace` reads is the one the real splitter produced.
 */

const RECIPE_ID = '01JCOOKINGSTEPMODEL0000000A';

function parsedSteps(instructions: readonly string[]): RecipeStep[] {
    return instructions.map((instruction, index) =>
        recipeStepSchema.parse({
            id: `01JCOOKINGSTEPMODEL000${String(index).padStart(4, '0')}`,
            recipeId: RECIPE_ID,
            stepNumber: index + 1,
            instruction,
        }),
    );
}

describe('step model — a recipe with a blank step and a multi-line step', () => {
    const recipe = parsedSteps([
        'Heat the oven to 200°C.',
        '   ',
        'Cream the butter and sugar. Beat in the eggs one at a time. Fold in the flour.',
        'Bake for 25 minutes.',
    ]);
    const steps = cookingStepsOf(recipe);
    const stepCount = countCookableSteps(recipe.map(({ instruction }) => instruction));

    it('skips the blank step, and the entry rule counts the same steps the walk walks', () => {
        expect(steps.map((step) => step.stepNumber)).toEqual([1, 3, 4]);
        expect(stepCount).toBe(steps.length);
        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount })).toBe(true);
        expect(cookLinkOutcome({ status: RecipeStatus.PUBLISHED, stepCount, isOwner: false, readable: true })).toBe(
            'cook',
        );
    });

    it('places every step from first to last, and nothing past the end', () => {
        expect(stepPlace(0, steps.length)).toEqual({ position: 1, total: 3, previous: null, next: 2 });
        expect(stepPlace(1, steps.length)).toEqual({ position: 2, total: 3, previous: 1, next: 3 });
        expect(stepPlace(2, steps.length)).toEqual({ position: 3, total: 3, previous: 2, next: null });
        expect(() => stepPlace(3, steps.length)).toThrow(expect.toSatisfy(isInvalidStepIndexError));
    });

    it('splits the multi-line step into its sentences, and places each line', () => {
        const lines = steps[1]?.lines ?? [];

        expect(lines).toEqual(['Cream the butter and sugar.', 'Beat in the eggs one at a time.', 'Fold in the flour.']);
        expect(lines.map((_, line) => linePlace(line, lines.length))).toEqual([
            { position: 1, total: 3 },
            { position: 2, total: 3 },
            { position: 3, total: 3 },
        ]);
        expect(() => linePlace(lines.length, lines.length)).toThrow(expect.toSatisfy(isInvalidLineIndexError));
    });

    it('shows no line count on a one-line step', () => {
        expect(linePlace(0, steps[0]?.lines.length ?? 0)).toBeNull();
    });
});

describe('step model — a recipe whose steps are all blank', () => {
    it('has no steps for the cook, is not cookable, and its cook link says so', () => {
        const recipe = parsedSteps([' ', '\n\t']);
        const stepCount = countCookableSteps(recipe.map(({ instruction }) => instruction));

        expect(cookingStepsOf(recipe)).toEqual([]);
        expect(stepCount).toBe(0);
        expect(isCookable({ status: RecipeStatus.PUBLISHED, stepCount })).toBe(false);
        expect(cookLinkOutcome({ status: RecipeStatus.PUBLISHED, stepCount, isOwner: true, readable: true })).toBe(
            'noSteps',
        );
    });
});
