import type { CookingStep } from '../cookingSteps.js';

/**
 * `count` lines of step text, numbered from 1.
 *
 * @param count - How many lines.
 * @returns The lines. Pure.
 */
export function makeStepLines(count: number): readonly string[] {
    return Array.from({ length: count }, (_, line) => `Line ${line + 1}.`);
}

/**
 * One cooking step, as `cookingStepsOf` would build it: step 1 with one line unless overridden.
 *
 * @param overrides - The fields to set.
 * @returns The step. Pure.
 */
export function makeCookingStep(overrides: Partial<CookingStep> = {}): CookingStep {
    return { stepNumber: 1, lines: makeStepLines(1), ...overrides };
}

/**
 * Cooking steps with the given line counts, as `cookingStepsOf` would build them.
 *
 * @param lineCounts - One entry per step: how many lines it has.
 * @returns The steps, numbered from 1. Pure.
 */
export function makeCookingSteps(...lineCounts: readonly number[]): readonly CookingStep[] {
    return lineCounts.map((count, index) => makeCookingStep({ stepNumber: index + 1, lines: makeStepLines(count) }));
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
