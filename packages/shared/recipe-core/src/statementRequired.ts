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
import { z } from 'zod';

import type { RecipeSourceType } from './recipe.types.js';
import type { SourceEvidenceFacts } from './sourceConflict.js';

/**
 * What the cook stated about a recipe, stored as `recipes.statement_kind` (ADR-0072 section 9): `authored` is "I wrote this",
 * `source` is any stated source (a web page, a book, a paid site; `source_kind` says which). `NULL` is no statement. The ONE
 * statement of the vocabulary: the database CHECK mirrors it.
 */
export const RECIPE_STATEMENT_KINDS = ['authored', 'source'] as const;

/** One statement kind. */
export type RecipeStatementKind = (typeof RECIPE_STATEMENT_KINDS)[number];

/** Runtime validator for {@link RecipeStatementKind}. Closed: every request and the database use it. */
export const recipeStatementKindSchema = z.enum(RECIPE_STATEMENT_KINDS);

/** What a reader makes of a statement kind it does not know (a newer server's). The server never sends it. */
export const UNRECOGNISED_STATEMENT_KIND = 'unrecognised';

/** A statement kind as a reader holds it: a known kind, or {@link UNRECOGNISED_STATEMENT_KIND}. */
export type RecipeStatementKindView = RecipeStatementKind | typeof UNRECOGNISED_STATEMENT_KIND;

/**
 * The tolerant wire read of a statement kind: a known kind is itself, any other STRING is {@link UNRECOGNISED_STATEMENT_KIND},
 * and a value that is not a string still fails. A preprocess, not a transform, because the contract fingerprint describes the
 * output side and records a transform as unrepresentable (the same shape as `recipeSourceKindViewSchema`).
 */
export const recipeStatementKindViewSchema = z.preprocess(
    (value) =>
        typeof value === 'string' && !(RECIPE_STATEMENT_KINDS as readonly string[]).includes(value)
            ? UNRECOGNISED_STATEMENT_KIND
            : value,
    z
        .enum([...RECIPE_STATEMENT_KINDS, UNRECOGNISED_STATEMENT_KIND])
        .describe(
            `${UNRECOGNISED_STATEMENT_KIND} is client-side only: what a client reads for a statement kind newer than it knows. The server never sends it.`,
        ),
);

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
    // A literal, not `RecipeSourceType.USER_CREATED`: `recipe.types` composes this module's view schema into the detail response.
    if (input.sourceType !== 'user_created') {
        return false;
    }

    if (input.statementKind === UNRECOGNISED_STATEMENT_KIND) {
        return true;
    }

    return input.statementKind === null && (input.contentPasted || input.evidence.length > 0);
}
