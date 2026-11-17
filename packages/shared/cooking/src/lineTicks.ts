import { stepAt } from './cookingSteps.js';
import type { CookingStep } from './cookingSteps.js';
import { InvalidLineIndexError } from './errors.js';

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

const sameKey = (a: LineKey, b: LineKey): boolean => a.stepIndex === b.stepIndex && a.lineIndex === b.lineIndex;

/**
 * Ticks one line. Ticking a ticked line changes nothing.
 *
 * @param ticks - The current ticks.
 * @param key - The line to tick.
 * @param steps - The cooking steps (`cookingStepsOf`); the line count is read from the named step, never passed in.
 * @returns The new ticks. Pure.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When `key.stepIndex` is not an index of `steps`.
 * @throws {InvalidLineIndexError} When `key.lineIndex` is not a line of that step.
 */
export function tickLine(ticks: LineTicks, key: LineKey, steps: readonly CookingStep[]): LineTicks {
    const lineCount = stepAt(steps, key.stepIndex).lines.length;

    if (!isLineOf(key.lineIndex, lineCount)) {
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

/** Whether an index is a whole number inside a step's lines. `Number.isInteger` is not redundant: 1.5 passes the bounds. */
const isLineOf = (lineIndex: number, lineCount: number): boolean =>
    Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lineCount;

/**
 * The focus line of a step when nothing was tapped: its first unticked line. `focusLineOf` adds the tapped line.
 *
 * @param ticks - The current ticks.
 * @param stepIndex - The step.
 * @param steps - The cooking steps (`cookingStepsOf`); the line count is read from the named step, never passed in.
 * @returns The focus line's index, or `null` when every line is ticked (Next coming) or the step has none. Pure.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of `steps`.
 */
export function focusLineIndex(ticks: LineTicks, stepIndex: number, steps: readonly CookingStep[]): number | null {
    const lineCount = stepAt(steps, stepIndex).lines.length;

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
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of `steps`.
 */
export function allLinesTicked(ticks: LineTicks, stepIndex: number, steps: readonly CookingStep[]): boolean {
    return stepAt(steps, stepIndex).lines.length > 0 && focusLineIndex(ticks, stepIndex, steps) === null;
}

/**
 * A line the cook tapped to make the focus, with the facts that were true at the tap. It is screen state, never stored.
 */
export interface TappedLine {
    readonly stepIndex: number;
    /**
     * The kept store's digest of the step's text at the tap (ADR-0094 section 9), the same source `focusLineOf` is
     * given.
     */
    readonly stepDigest: string;
    readonly lineIndex: number;
    /** This step's ticked line indexes at the tap, in any order. */
    readonly tickedAtTap: readonly number[];
}

/** What {@link focusLineOf} decides the focus line from. */
export interface FocusLineInput {
    readonly ticks: LineTicks;
    /** The session's step. */
    readonly stepIndex: number;
    readonly steps: readonly CookingStep[];
    /** The kept store's digest of the session step's text now. */
    readonly stepDigest: string;
    /** The cook's tap, or `null` when there is none. */
    readonly tapped: TappedLine | null;
}

const sameLineSet = (tickedNow: readonly number[], tickedAtTap: readonly number[]): boolean =>
    new Set(tickedAtTap).size === tickedNow.length && tickedNow.every((line) => tickedAtTap.includes(line));

/**
 * The focus line of the session's step. The tapped line is the focus only while all four facts hold: the session is on
 * the step that was tapped, its text is unchanged (same digest), the line exists and is unticked, and the step's ticked
 * set is the one at the tap, so a tick or untick from any source ends the tap. Otherwise it is the first unticked
 * line, so unticking a line above the focus still makes it the focus again. Nothing is written: an invalid tap is
 * simply never the answer.
 *
 * @param input - The ticks, the session step and its digest, and the tap.
 * @returns The focus line's index, or `null` when every line is ticked or the step has none. Pure.
 * @throws {InvalidTotalStepsError} When the recipe has no steps.
 * @throws {InvalidStepIndexError} When `stepIndex` is not an index of `steps`.
 */
export function focusLineOf({ ticks, stepIndex, steps, stepDigest, tapped }: FocusLineInput): number | null {
    const lineCount = stepAt(steps, stepIndex).lines.length;

    if (
        tapped !== null &&
        tapped.stepIndex === stepIndex &&
        tapped.stepDigest === stepDigest &&
        isLineOf(tapped.lineIndex, lineCount) &&
        !isLineTicked(ticks, { stepIndex, lineIndex: tapped.lineIndex }) &&
        sameLineSet(
            ticks.ticked.filter((key) => key.stepIndex === stepIndex).map((key) => key.lineIndex),
            tapped.tickedAtTap,
        )
    ) {
        return tapped.lineIndex;
    }

    return focusLineIndex(ticks, stepIndex, steps);
}
