import type { CookingStep } from './cookingSteps.js';
import { InvalidLineIndexError, InvalidStepIndexError } from './errors.js';

/** One line of one step. Both indexes are 0-based. */
export interface LineKey {
    readonly stepIndex: number;
    readonly lineIndex: number;
}

/**
 * The cook's line ticks for one cooking session. An array of keys rather than a `Set`, so the state survives a JSON
 * round trip (the session's own rule, `types.ts`).
 *
 * These are session ticks, not the recipe's ingredient cook marks. They are keyed by the cooking step's index
 * (`cookingStepsOf`) and the line's index, and are valid only while the step's text is unchanged; storing them is the
 * resume story's work (FR-040).
 */
export interface LineTicks {
    readonly ticked: readonly LineKey[];
}

/**
 * A session with no line ticked: the start, and "Cook it again".
 *
 * @returns The empty state. Pure.
 */
export function createLineTicks(): LineTicks {
    return { ticked: [] };
}

/**
 * The line count of one step, read from the parsed steps.
 *
 * @param stepIndex - The step.
 * @param steps - The cooking steps (`cookingStepsOf`).
 * @returns The step's line count. Pure.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of `steps`.
 */
function lineCountOf(stepIndex: number, steps: readonly CookingStep[]): number {
    const step = Number.isInteger(stepIndex) ? steps[stepIndex] : undefined;

    // `steps[i]` is typed `CookingStep` but is `undefined` past the end (`noUncheckedIndexedAccess` is off).
    if (step === undefined) {
        throw new InvalidStepIndexError(stepIndex, steps.length);
    }

    return step.lines.length;
}

const sameKey = (a: LineKey, b: LineKey): boolean => a.stepIndex === b.stepIndex && a.lineIndex === b.lineIndex;

/**
 * Ticks one line. Ticking a ticked line changes nothing.
 *
 * @pattern Command — over the {@link LineTicks} state, as the session reducer's commands are
 * @param ticks - The current ticks.
 * @param key - The line to tick.
 * @param steps - The cooking steps (`cookingStepsOf`); the line count is read from the named step, never passed in.
 * @returns The new ticks. Pure.
 * @throws {InvalidStepIndexError} When `key.stepIndex` is not an index of `steps`.
 * @throws {InvalidLineIndexError} When `key.lineIndex` is not a line of that step.
 */
export function tickLine(ticks: LineTicks, key: LineKey, steps: readonly CookingStep[]): LineTicks {
    const lineCount = lineCountOf(key.stepIndex, steps);

    if (!Number.isInteger(key.lineIndex) || key.lineIndex < 0 || key.lineIndex >= lineCount) {
        throw new InvalidLineIndexError(key.lineIndex, lineCount);
    }

    if (isLineTicked(ticks, key)) {
        return ticks;
    }

    return { ticked: [...ticks.ticked, { stepIndex: key.stepIndex, lineIndex: key.lineIndex }] };
}

/**
 * Unticks one line. A line above the focus becomes the focus again. Unticking an unticked line changes nothing.
 *
 * @param ticks - The current ticks.
 * @param key - The line to untick.
 * @returns The new ticks. Pure.
 */
export function untickLine(ticks: LineTicks, key: LineKey): LineTicks {
    return isLineTicked(ticks, key) ? { ticked: ticks.ticked.filter((ticked) => !sameKey(ticked, key)) } : ticks;
}

/**
 * Whether one line is ticked.
 *
 * @param ticks - The current ticks.
 * @param key - The line.
 * @returns `true` when it is ticked. Pure.
 */
export function isLineTicked(ticks: LineTicks, key: LineKey): boolean {
    return ticks.ticked.some((ticked) => sameKey(ticked, key));
}

/**
 * The focus line of a step: its first unticked line. Nothing jumps to a line, so the focus is never anything else.
 *
 * @param ticks - The current ticks.
 * @param stepIndex - The step.
 * @param steps - The cooking steps (`cookingStepsOf`); the line count is read from the named step, never passed in.
 * @returns The focus line's index, or `null` when every line is ticked (Next coming) or the step has none. Pure.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of `steps`.
 */
export function focusLineIndex(ticks: LineTicks, stepIndex: number, steps: readonly CookingStep[]): number | null {
    const lineCount = lineCountOf(stepIndex, steps);

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        if (!isLineTicked(ticks, { stepIndex, lineIndex })) {
            return lineIndex;
        }
    }

    return null;
}

/**
 * How many of a step's lines are ticked, for "You ticked {n} lines".
 *
 * @param ticks - The current ticks.
 * @param stepIndex - The step.
 * @returns The count. Pure.
 */
export function tickedLineCount(ticks: LineTicks, stepIndex: number): number {
    return ticks.ticked.filter((key) => key.stepIndex === stepIndex).length;
}

/**
 * Whether every line of a step is ticked, which shows Next coming. A step with no lines never is.
 *
 * @param ticks - The current ticks.
 * @param stepIndex - The step.
 * @param steps - The cooking steps (`cookingStepsOf`); the line count is read from the named step, never passed in.
 * @returns `true` when the step has lines and all are ticked. Pure.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of `steps`.
 */
export function allLinesTicked(ticks: LineTicks, stepIndex: number, steps: readonly CookingStep[]): boolean {
    return lineCountOf(stepIndex, steps) > 0 && focusLineIndex(ticks, stepIndex, steps) === null;
}
