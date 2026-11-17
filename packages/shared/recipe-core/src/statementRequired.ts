/**
 * Whether a recipe must carry the cook's statement before it may be left published and public (the statement rule).
 *
 * DESIGN PATTERN: **Specification**, the sibling of `sourceConflictOf` and a separate rule on purpose. `sourceConflictOf` is the
 * ONE seam the feature-020 hold replaces; this rule survives that hold, because "the cook has said whose words these are" is
 * a question the hold does not answer. The two are never merged: a caller asks both, in the policies' order.
 *
 * ## The rule
 *
 * A recipe the cook wrote (`user_created`) that has NO statement, and whose content was pasted or that has any source evidence,
 * may not be published and public until the cook says "I wrote this". A recipe typed by hand, with no evidence, publishes with
 * nothing said: "typed" means "no paste was seen", which is the client's word and can only make the rule stricter. Evidence
 * and the stored statement are server facts. Nothing sets `statement_kind = 'authored'` for the cook.
 *
 * The SQL twin is the database function `recipe_needs_statement(recipe_id)` (migration 0087), used by account erasure, which
 * deletes a recipe it cannot donate. A LOCAL e2e test holds the pair together over the cross product.
 *
 * @pattern Specification — one pure predicate, one SQL twin
 */
import { RecipeSourceType, UNRECOGNISED_STATEMENT_KIND, type RecipeStatementKindView } from './recipe.types.js';
import type { SourceEvidenceFacts } from './sourceConflict.js';

/** The input to {@link statementRequiredOf}. Every member is REQUIRED, so a caller states each. */
export interface StatementRequiredInput {
    /** The recipe's provenance label now. */
    readonly sourceType: RecipeSourceType;
    /** What the cook stated, or `null` (no statement). A reader may hold a kind it does not know. */
    readonly statementKind: RecipeStatementKindView | null;
    /** Whether the cook's client said content was pasted into the recipe (`content_pasted_at IS NOT NULL`). */
    readonly contentPasted: boolean;
    /** Every evidence row of the recipe; only whether any exist is read. */
    readonly evidence: readonly SourceEvidenceFacts[];
}

/**
 * Whether the recipe needs the cook's statement before it may be published and public.
 *
 * A statement kind this reader does not know fails CLOSED (`true`), as `privateRuleOf` treats an unknown source kind as the
 * most closed one: it cannot be shown that the cook attested.
 *
 * @param input - The recipe's label, its statement, whether content was pasted, and its evidence.
 * @returns `true` when Public must be refused for want of a statement. Pure.
 */
export function statementRequiredOf(input: StatementRequiredInput): boolean {
    if (input.sourceType !== RecipeSourceType.USER_CREATED) {
        return false;
    }

    if (input.statementKind === UNRECOGNISED_STATEMENT_KIND) {
        return true;
    }

    return input.statementKind === null && (input.contentPasted || input.evidence.length > 0);
}
