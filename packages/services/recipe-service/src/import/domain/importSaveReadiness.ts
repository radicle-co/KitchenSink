/**
 * `isReadyToSave` — whether one bulk import item may be saved yet.
 *
 * DESIGN PATTERN: **Specification** — pure and total.
 *
 *  - `bindBest`: once matched. A line still checking binds its proposal, so nothing else is awaited.
 *  - `keepAsWritten`: matched, and either no undecided line is still checking, or the match is older than the wait.
 *  - `review`: the cook ends it, not a clock. Ready when the wizard was closed, or matched with no open line.
 *
 * ⚠️ The wait is a PARAMETER. The blueprint names `CHECKING_WAIT` but no number exists anywhere, and this module does
 * not invent one. "Longer than" is read as strictly greater than.
 */
import { isOpenLine, type ItemReview, type LineFacts, type MatchMode } from './importBindingPolicy.js';

/** The inputs of {@link isReadyToSave}. */
export interface ReadinessInput {
    readonly mode: MatchMode;
    readonly itemReview: ItemReview;
    /** Whether the wizard was closed with Save and leave. Meaningful in `review` only. */
    readonly reviewClosed: boolean;
    /** How long ago matching finished for this item, in ms; `undefined` while it has not. */
    readonly matchedForMs: number | undefined;
    /** How long a checking line is awaited in `keepAsWritten`. */
    readonly checkingWaitMs: number;
    readonly lines: readonly LineFacts[];
}

/**
 * Whether an item may be saved now.
 *
 * @param input - The mode, the marks, the match age and the lines.
 * @returns `true` when saving now is correct. Pure and total.
 */
export function isReadyToSave(input: ReadinessInput): boolean {
    const { matchedForMs } = input;

    switch (input.mode) {
        case 'bindBest':
            return matchedForMs !== undefined;

        case 'keepAsWritten': {
            if (matchedForMs === undefined) {
                return false;
            }

            const waiting = input.lines.some((line) => line.cookChoice === undefined && line.state === 'checking');

            return !waiting || matchedForMs > input.checkingWaitMs;
        }

        case 'review':
            return input.reviewClosed || (matchedForMs !== undefined && !input.lines.some(isOpenLine));
    }
}
