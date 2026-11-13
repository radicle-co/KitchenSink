import type { RecipeStep } from '@kitchensink/recipe-core';

import { hasStepText } from './cookability.js';
import { splitStepLines } from './stepLines.js';

/** One step as the cook walks it: the recipe's own step number, and its text split into lines. Never empty. */
export interface CookingStep {
    readonly stepNumber: number;
    readonly lines: readonly string[];
}

/**
 * The recipe's steps as cooking mode walks them, in recipe order. A step with no text is not a step for the cook (FR-033a).
 *
 * A step without text (`hasStepText`, the one definition) is not a step for the cook: it is skipped here, so every count downstream (the
 * place, the track, Done, and the step count `isCookable` and `cookLinkOutcome` read) covers only steps with text,
 * and no step with no lines reaches the reducers.
 *
 * @param steps - The recipe's steps, in order.
 * @returns One {@link CookingStep} per step with text. Pure.
 */
export function cookingStepsOf(
    steps: readonly Pick<RecipeStep, 'stepNumber' | 'instruction'>[],
): readonly CookingStep[] {
    return steps
        .filter(({ instruction }) => hasStepText(instruction))
        .map(({ stepNumber, instruction }) => ({ stepNumber, lines: splitStepLines(instruction) }));
}
