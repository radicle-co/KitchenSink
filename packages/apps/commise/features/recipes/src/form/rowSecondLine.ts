/**
 * @module @commise/features-recipes/form — what a read row's second line says (build spec §7.5.1's row-state table;
 * owner "Adopted": healthy rows stay quiet, overturning `ingredientStatusExplanation.md` §3a's always-shown glyph).
 *
 * A healthy row has no second line. A row the lookup is still working on says so in `inkMuted` with a spinner. A row
 * that needs the cook adds an `attention` line that is a control: it opens the row's existing panel (shortlist,
 * candidates, explanation) or, for a line that names no food, starts the food search in the row.
 *
 * Three states the spec's table does not name are decided here (reported as spec gaps): `NEEDS_REVIEW` keeps its own
 * status word as the attention text; a private food, an outage and the cook's own wording are quiet, because nothing
 * is wrong and nothing blocks Publish.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Visitor — an exhaustive `switch` over `FoodResolutionStatus`
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { RowPolicyLine } from './ingredientRowPolicy.js';
import type { RecipeFormMessages } from './messages.js';
import { isResolvedIngredientId } from './validate.js';

/** The second line's message key, in `RecipeFormMessages`. */
export type RowSecondLineKey = keyof Pick<
    RecipeFormMessages,
    | 'rowStateChooseMatch'
    | 'rowStateNoMatch'
    | 'rowStateLookupFailed'
    | 'rowStateFoodRemoved'
    | 'rowStateLookingUp'
    | 'statusNeedsReview'
>;

/** A read row's second line. */
export type RowSecondLine =
    /** A healthy row: no line at all. */
    | { readonly kind: 'none' }
    /** The lookup is working: a spinner and the words, never a control. */
    | { readonly kind: 'working'; readonly text: RowSecondLineKey }
    /** The cook must act: a control that opens the row's panel, or the food search for a line with no food. */
    | { readonly kind: 'attention'; readonly text: RowSecondLineKey; readonly opens: 'panel' | 'entry' };

const NONE: RowSecondLine = { kind: 'none' };
const LOOKING_UP: RowSecondLine = { kind: 'working', text: 'rowStateLookingUp' };
const attention = (text: RowSecondLineKey): RowSecondLine => ({ kind: 'attention', text, opens: 'panel' });

/**
 * A read row's second line. Pure.
 *
 * @param line - The draft line.
 * @param retrying - A Try again for the line's failed lookup is running.
 * @returns The line to draw.
 */
export const rowSecondLineOf = (line: RowPolicyLine, retrying: boolean): RowSecondLine => {
    // ⛔ The SAME predicate the validator refuses on, so the row that blocks Publish is the row that says so.
    if (!isResolvedIngredientId(line.ingredientId)) {
        return { kind: 'attention', text: 'rowStateNoMatch', opens: 'entry' };
    }

    if (line.isUserEntered) {
        return NONE;
    }

    // ⚠️ A bound line the read said nothing about is `RESOLVED`, as `rowPresentationOf` reads it.
    const status = line.resolutionStatus ?? FoodResolutionStatus.RESOLVED;

    switch (status) {
        case FoodResolutionStatus.RESOLVED:
        case FoodResolutionStatus.RESOLVED_UNAVAILABLE:
        case FoodResolutionStatus.FOOD_UNREACHABLE:
            return NONE;
        case FoodResolutionStatus.PENDING:
        case FoodResolutionStatus.PENDING_VERIFICATION:
            return LOOKING_UP;
        case FoodResolutionStatus.UNRESOLVED:
        case FoodResolutionStatus.AMBIGUOUS:
            return attention('rowStateChooseMatch');
        case FoodResolutionStatus.NEEDS_REVIEW:
            return attention('statusNeedsReview');
        case FoodResolutionStatus.NOT_FOUND:
            return attention('rowStateNoMatch');
        case FoodResolutionStatus.FAILED:
            return retrying ? LOOKING_UP : attention('rowStateLookupFailed');
        case FoodResolutionStatus.FOOD_REMOVED:
            return attention('rowStateFoodRemoved');
    }
};
