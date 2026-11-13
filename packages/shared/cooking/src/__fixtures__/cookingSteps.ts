import type { CookingStep } from '../cookingSteps.js';

/**
 * Cooking steps with the given line counts, as `cookingStepsOf` would build them.
 *
 * @param lineCounts - One entry per step: how many lines it has.
 * @returns The steps, numbered from 1. Pure.
 */
export function makeCookingSteps(...lineCounts: readonly number[]): readonly CookingStep[] {
    return lineCounts.map((count, index) => ({
        stepNumber: index + 1,
        lines: Array.from({ length: count }, (_, line) => `Line ${line + 1}.`),
    }));
}

/**
 * A recipe of `stepCount` one-line steps, for tests that care only how many steps there are.
 *
 * @param stepCount - How many steps.
 * @returns The steps. Pure.
 */
export function makeOneLineSteps(stepCount: number): readonly CookingStep[] {
    return makeCookingSteps(...Array.from({ length: stepCount }, () => 1));
}
