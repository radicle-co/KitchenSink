/**
 * @module timerStep — which step of a recipe a timer belongs to. The timer stores the step's digest as well as its
 * index, so an edit that moves or rewrites a step cannot attach the timer to the wrong text.
 *
 * @pattern Specification — a pure rule that answers "which step is this timer's?" for every caller (the exit message,
 * the timer dock) from one place.
 */
import { cookingStepsOf, matchStepStrict, stepDigest } from '@kitchensink/cooking-core';
import type { ActiveTimer } from '@kitchensink/cooking-core';

import type { CookingRecipe } from '../cookingViewProps.js';
import type { TimerStep } from './timerCopy.js';

/**
 * The step a timer belongs to, as {@link timerLabel} reads it.
 *
 * @param timer - The timer's recipe, stored step index and step digest.
 * @param recipe - The recipe now open, or `undefined` when none is.
 * @returns The 1-based place and the lines of the one step whose digest matches. For a timer of another recipe, a
 *   step edited since, or a digest that matches more than one step: the stored place and no lines, never a guess at
 *   another step. Never throws. Pure.
 */
export function timerStepOf(
    timer: Pick<ActiveTimer, 'recipeId' | 'stepIndex' | 'stepDigest'>,
    recipe: Pick<CookingRecipe, 'id' | 'steps'> | undefined,
): TimerStep {
    const stored: TimerStep = { number: timer.stepIndex + 1, lines: [] };

    if (recipe === undefined || recipe.id !== timer.recipeId) {
        return stored;
    }

    const steps = cookingStepsOf(recipe.steps);
    const byNumber = new Map(recipe.steps.map(({ stepNumber, instruction }) => [stepNumber, instruction]));
    const digests = steps.map(({ stepNumber }) => stepDigest(byNumber.get(stepNumber) ?? ''));
    const at = matchStepStrict({ index: timer.stepIndex, digest: timer.stepDigest }, digests);
    const step = at === undefined ? undefined : steps[at];

    return at === undefined || step === undefined ? stored : { number: at + 1, lines: step.lines };
}
