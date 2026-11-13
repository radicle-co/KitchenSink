import type { CookingStep } from './cookingSteps.js';
import { InvalidLineIndexError, InvalidStepIndexError, InvalidTotalStepsError } from './errors.js';

/** Where the cook is among a recipe's steps, numbered from 1 for display. */
export interface StepPlace {
    /** "Step {position} of {total}". */
    readonly position: number;
    readonly total: number;
    /** The step Back returns to, or `null` on the first step, where Back returns to the recipe. */
    readonly previous: number | null;
    /** The step Next opens, or `null` on the last step, where Next is Finish. */
    readonly next: number | null;
}

/** Where the focus line sits within its step, numbered from 1 for display. */
export interface LinePlace {
    /** "Line {position} of {total}". */
    readonly position: number;
    readonly total: number;
}

/**
 * The 1-based place of a step. The domain is 0-based; this is the one place that adds one.
 *
 * @param stepIndex - The 0-based step index.
 * @param totalSteps - The recipe's step count.
 * @returns The displayed place, with the neighbours Back and Next lead to.
 * @throws {InvalidTotalStepsError} When `totalSteps` is not a positive integer.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of the recipe.
 */
export function stepPlace(stepIndex: number, totalSteps: number): StepPlace {
    if (!Number.isInteger(totalSteps) || totalSteps < 1) {
        throw new InvalidTotalStepsError(totalSteps);
    }

    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= totalSteps) {
        throw new InvalidStepIndexError(stepIndex, totalSteps);
    }

    const position = stepIndex + 1;

    return {
        position,
        total: totalSteps,
        previous: position > 1 ? position - 1 : null,
        next: position < totalSteps ? position + 1 : null,
    };
}

/**
 * The 1-based place of a line within its step, or `null` when the step has one line or none, because "Line 1 of 1"
 * is never shown.
 *
 * @param lineIndex - The 0-based line index.
 * @param step - The parsed step (`cookingStepsOf`); its line count is read from its lines, never passed in.
 * @returns The displayed place, or `null` when no line count is shown.
 * @throws {InvalidLineIndexError} When the step has lines and `lineIndex` is not one of them.
 */
export function linePlace(lineIndex: number, step: CookingStep): LinePlace | null {
    const lineCount = step.lines.length;

    if (lineCount <= 1) {
        return null;
    }

    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lineCount) {
        throw new InvalidLineIndexError(lineIndex, lineCount);
    }

    return { position: lineIndex + 1, total: lineCount };
}
