/**
 * `importFlagOf` — the THIRD mapping over `identityReadingOf` (ADR-0071 §9): whether a bound import line is FLAGGED
 * for the cook in the review list.
 *
 * DESIGN PATTERN: **Visitor** — an exhaustive switch over `IdentityReading`, with no default, so a new reading is a
 * compile error here exactly as in `matchStateOf` and `resolveLineStatus`. The classifier is reused, never copied.
 *
 * Nothing is stored: "flagged" is derived at read time.
 *
 * ⚠️ `unasked` reads `checking` only while a review is still OWED. When the gate refused, gave up or was never asked,
 * the verdict will never come, and ADR-0071 §9 forbids reading `checking` forever, so it is flagged. The blueprint's
 * one-line mapping had no review input; this is the best-justified repair.
 */
import type { IdentityReading } from '../../recipes/domain/lineVerification.js';
import type { MatchFacts } from '../../recipes/domain/matchState.js';

/** The flag state of one bound line. */
export type ImportFlag =
    | { readonly state: 'clear' }
    | { readonly state: 'checking' }
    | { readonly state: 'flagged'; readonly suggestionFoodId: string | undefined };

/** The inputs of {@link importFlagOf}. */
export interface FlagInput {
    /** What the stored verdict says about the bound food (`identityReadingOf`; `unasked` with no verdict). */
    readonly reading: IdentityReading;
    /** Where the review stands, as `matchStateOf` reads it. */
    readonly review: MatchFacts['review'];
    readonly boundFoodId: string;
    /** The default candidate's food, or `undefined`. */
    readonly defaultFoodId: string | undefined;
}

/**
 * Decide the flag for one bound line.
 *
 * @param input - The reading, the review state, the bound food and the default candidate.
 * @returns clear, checking, or flagged with the default as a suggestion when it differs from the bound food. Pure and total.
 */
export function importFlagOf(input: FlagInput): ImportFlag {
    const flagged: ImportFlag = {
        state: 'flagged',
        suggestionFoodId: input.defaultFoodId !== input.boundFoodId ? input.defaultFoodId : undefined,
    };

    switch (input.reading) {
        case 'agree':
            return { state: 'clear' };
        case 'unasked':
            return input.review === 'asked' ? { state: 'checking' } : flagged;
        case 'contradict':
        case 'doubt':
        case 'hedged':
        case 'abstain':
        case 'unreadable':
            return flagged;
    }
}
