import type { RecipeStep } from '@kitchensink/recipe-core';

import { hasStepText } from './cookability.js';
import { stepDigest } from './stepDigest.js';

/**
 * The digest of each step the cook walks: one per step with text (as `cookingStepsOf`), of its raw instruction.
 * The one rule both sides of a saved position use: the writer stores `stepDigestsOf(steps)[index]`, the reader matches
 * against `stepDigestsOf(steps)`.
 *
 * @param steps - The recipe's steps, in order.
 * @returns The digests, aligned index for index with `cookingStepsOf(steps)`. Pure.
 */
export function stepDigestsOf(steps: readonly Pick<RecipeStep, 'stepNumber' | 'instruction'>[]): readonly string[] {
    return steps
        .filter(({ instruction }) => hasStepText(instruction))
        .map(({ instruction }) => stepDigest(instruction));
}
