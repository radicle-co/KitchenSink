/**
 * Where the review of a verification key stands when there is no verdict on record.
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total. The row's PERSISTED disposition (F10) is read, never the
 * gate policy re-run here; and for a contained test principal, whose review is never sent (ADR-0040), it is `notAsked`. The
 * paste screen's projection and the bulk import's flag both read a key through this one rule (ADR-0072 §6), so a spent
 * budget or a given-up review cannot read as `checking` on one screen and as settled on another.
 */
import type { MatchFacts } from './matchState.js';

/** What the standing is read from: the keys the gate gave up on, the keys the ceiling refused this period, and containment. */
export interface ReviewStandingRead {
    readonly exhausted: ReadonlySet<string>;
    /** The keys whose review the ceiling refused in the current spend period. */
    readonly budgetSpent: ReadonlySet<string>;
    readonly contained: boolean;
}

/**
 * The review standing of one key. Pure.
 *
 * @param key - The verification key, or `null` for a line that has none.
 * @param refused - Whether the gate refused this review (persisted on the match row; a saved line has none).
 * @param read - What is on record about the keys.
 * @returns The review standing.
 */
export function reviewStandingOf(key: string | null, refused: boolean, read: ReviewStandingRead): MatchFacts['review'] {
    // ⛔ A spent budget is a fact about the KEY in the CURRENT period (the DAL filtered by it), so it comes first: it is
    // the only reason a review is owed and will not be sent, and it must not read as `checking` or `unchecked`.
    if (key !== null && read.budgetSpent.has(key)) {
        return 'budgetSpent';
    }

    if (refused) {
        return 'refused';
    }

    if (key !== null && read.exhausted.has(key)) {
        return 'exhausted';
    }

    return read.contained ? 'notAsked' : 'asked';
}
