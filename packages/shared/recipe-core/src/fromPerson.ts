/**
 * Whether the cook said a recipe is another person's (ADR-0095).
 *
 * DESIGN PATTERN: **Specification**, the sibling of `statementRequiredOf` and `sourceConflictOf` and a separate rule for a
 * separate reason: the evidence rule is the seam the feature-020 hold replaces, and the statement rule asks whether the cook
 * attested; this one only reads what the cook already said, and it survives both. A recipe said to be another person's is
 * Private at every route, so a policy takes the answer as a REQUIRED input and no route can reach Public without it.
 *
 * The SQL twin is the database function `recipe_is_from_person(recipe_id)` (migration 0087), used by account erasure, which
 * never donates such a recipe. A LOCAL e2e test holds the pair together over every statement kind.
 *
 * @pattern Specification — one pure predicate, one SQL twin
 */
import type { RecipeStatementKindView } from './recipe.types.js';

/**
 * Whether the stored statement says "from another person".
 *
 * A kind this reader does not know is NOT read as one: it fails closed in `statementRequiredOf`, which is where an unknown
 * statement is judged.
 *
 * @param statementKind - What the cook stated, or `null` (no statement).
 * @returns `true` when the recipe may not be public. Pure.
 */
export function fromPersonOf(statementKind: RecipeStatementKindView | null): boolean {
    return statementKind === 'fromPerson';
}
