import type { RecipeStep } from '@kitchensink/recipe-core';

import { hasStepText } from './cookability.js';
import { InvalidStepIndexError, InvalidTotalStepsError } from './errors.js';
import { splitStepLines } from './stepLines.js';

/** One step as the cook walks it: the recipe's own step number, and its text split into lines. Never empty. */
export interface CookingStep {
    readonly stepNumber: number;
    readonly lines: readonly string[];
}

/**
 * The recipe's steps as cooking mode walks them, in recipe order (FR-033a).
 *
 * A step without text (`hasStepText`, the one definition) is not a step for the cook: it is skipped here, so every
 * count downstream (the place, the track, Done, and the step count `isCookable` and `cookLinkOutcome` read) covers
 * only steps with text, and no step with no lines reaches the reducers.
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

/**
 * The step at an index: the one rule for "is this a step of the recipe?" that every step-walk function reads.
 *
 * @param steps - The cooking steps (`cookingStepsOf`).
 * @param index - The 0-based step index.
 * @returns The step. Pure.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When `index` is not an integer in `[0, steps.length - 1]`.
 */
export function stepAt(steps: readonly CookingStep[], index: number): CookingStep {
    if (steps.length === 0) {
        throw new InvalidTotalStepsError(0);
    }

    // `steps[i]` is typed `CookingStep` but is `undefined` past the end (`noUncheckedIndexedAccess` is off).
    const step = Number.isInteger(index) ? steps[index] : undefined;

    if (step === undefined) {
        throw new InvalidStepIndexError(index, steps.length);
    }

    return step;
}
