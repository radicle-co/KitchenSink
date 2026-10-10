/**
 * @module @commise/features-recipes/form — the ONE mapping from a line's resolution status to the message key of its
 * word. The words are the glossary's (`buildSpec.md` §2.1, `evaluateFinal.md` F19): a status the editor row names reads the
 * row's own `rowState*` key, so the recipe page, the editor and the lookup announcement say the same thing and the
 * retired words ("Needs a pick", "Not resolved", "Resolution failed", "Resolving…") exist nowhere. `resolutionStatusLabel` (`./props.ts`) reads it to produce the copy; the editor row policy
 * (`./ingredientRowPolicy.ts`) reads it to name the word a row shows, deciding only WHETHER a row shows one.
 *
 * A leaf module on purpose: the pure row policy depends on this and nothing heavier, so it never imports the form's
 * props and transitions (staff-architect REVIEW F4).
 *
 * @pattern Visitor — an exhaustive `switch` over `FoodResolutionStatus`
 */
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { RecipeFormMessages } from './messages.js';

/** The message key of each resolution status's word. */
export type ResolutionStatusWordKey = keyof Pick<
    RecipeFormMessages,
    | 'rowStateLookingUp'
    | 'rowStateChooseMatch'
    | 'rowStateNoMatch'
    | 'rowStateLookupFailed'
    | 'rowStateFoodRemoved'
    | 'statusResolved'
    | 'statusNeedsReview'
    | 'statusPendingVerification'
    | 'statusResolvedUnavailable'
    | 'statusFoodUnreachable'
>;

/**
 * The message key naming an ingredient line's resolution status. Pure — the ONE mapping from a
 * {@link FoodResolutionStatus} to its word, read by `resolutionStatusLabel` (`./props.ts`) and by the editor row policy
 * (`ingredientRowPolicy.ts`), which decides only WHETHER a row shows its word, never which word it is.
 *
 * @param status - The line's resolution status.
 * @returns The key of its word in `RecipeFormMessages`.
 */
export const resolutionStatusWordKey = (status: FoodResolutionStatus): ResolutionStatusWordKey => {
    switch (status) {
        case 'PENDING':
            return 'rowStateLookingUp';
        case 'UNRESOLVED':
            return 'rowStateChooseMatch';
        case 'RESOLVED':
            return 'statusResolved';
        case 'NOT_FOUND':
            return 'rowStateNoMatch';
        case 'FAILED':
            return 'rowStateLookupFailed';
        case 'NEEDS_REVIEW':
            // U14 — OUR OWN verdict, not food-service's. The gate read the line's raw source text against the
            // food we resolved it to and disagreed, so this line's nutrition is withheld until a human picks.
            return 'statusNeedsReview';
        case 'PENDING_VERIFICATION':
            // U4c — KTD-A's quiet state: the bind is made, the check is in flight, the figure re-flows when
            // the verdict lands. Deliberately calm copy — there is nothing for the cook to act on yet.
            return 'statusPendingVerification';
        case 'AMBIGUOUS':
            // U13 (D7/R9) — the gate abstained over materially-different candidates. Author-actionable:
            // the batched review surface and the inline pick affordance both key off this member.
            return 'rowStateChooseMatch';
        case 'RESOLVED_UNAVAILABLE':
            // U13 (R20) — bound, but the food is another author's private one. Name-only for this viewer:
            // directionally "details unavailable", never an error, and no pick affordance.
            return 'statusResolvedUnavailable';
        case 'FOOD_REMOVED':
            // Owner rulings 3 + 4 — the food's AUTHOR withdrew it. ⛔ Deliberately NOT the unavailable copy
            // one case up: that says "exists, not served to you" and nothing is wrong, while this says the
            // food is gone for everyone. The line keeps its amount and unit — those are the recipe's, never
            // the food's — so there is nothing broken to fix, only nutrition that no longer counts.
            return 'rowStateFoodRemoved';
        case 'FOOD_UNREACHABLE':
            // Plan 002 R2 — the line is bound, but food could not be asked on this read. Transient, so NOT the
            // removed copy one case up: an outage must never read as a permanent fact about the recipe.
            return 'statusFoodUnreachable';
    }
};
