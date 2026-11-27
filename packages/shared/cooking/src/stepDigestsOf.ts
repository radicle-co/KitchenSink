import type { RecipeStep } from '@kitchensink/recipe-core';

import { hasStepText } from './cookability.js';
import { stepDigest } from './stepDigest.js';

/**
 * The digest of each step the cook walks: one per step with text (as `cookingStepsOf`), of its raw instruction.
 * The reader of a saved position matches against `stepDigestsOf(steps)`, so whatever stores a position's digest must
 * store `stepDigestsOf(steps)[index]`: a digest taken over the raw steps, blank ones included, shifts every digest
 * after a blank step and no timer matches.
 *
 * @param steps - The recipe's steps, in order.
 * @returns The digests, aligned index for index with `cookingStepsOf(steps)`. Pure.
 */
export function stepDigestsOf(steps: readonly Pick<RecipeStep, 'stepNumber' | 'instruction'>[]): readonly string[] {
    return steps
        .filter(({ instruction }) => hasStepText(instruction))
        .map(({ instruction }) => stepDigest(instruction));
}
