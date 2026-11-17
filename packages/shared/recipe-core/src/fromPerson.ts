/**
 * Whether the cook said a recipe is another person's (ADR-0095).
 *
 * DESIGN PATTERN: **Specification**, the sibling of `statementRequiredOf` and `sourceConflictOf` and a separate rule for a
 * separate reason: the evidence rule is the seam the feature-020 hold replaces, and the statement rule asks whether the cook
 * attested; this one only reads what the cook already said, and it survives both. A recipe said to be another person's is
 * Private at every route, so a policy takes the answer as a REQUIRED input and no route can reach Public without it.
 *
 * The SQL twin is the database function `recipe_is_from_person(recipe_id)` (migrations 0087 and 0090), used by account erasure, which
 * never donates such a recipe. A LOCAL e2e test holds the pair together over every statement kind.
 *
 * @pattern Specification — one pure predicate, one SQL twin
 */
import type { RecipeStatementKindView } from './recipe.types.js';

/**
 * Whether the recipe is another person's: the stored statement says so, or there is no stored statement and the cook once
 * attested "from another person".
 *
 * The second arm closes a way round the first. A cook who said "from another person" and then cleared the statement left a
 * recipe with nothing that remembered it, so it could be published as their own. An explicit later statement (`authored`, a
 * source) is the cook's own answer and replaces it.
 *
 * A kind this reader does not know is NOT read as "from another person": it fails closed in `statementRequiredOf`, which is
 * where an unknown statement is judged.
 *
 * @param input.statementKind - What the cook stated, or `null` (no statement).
 * @param input.attestedFromPerson - Any `fromPerson` attestation row exists for the recipe, whatever came after it.
 * @returns `true` when the recipe may not be public. Pure.
 */
export function fromPersonOf(input: {
    readonly statementKind: RecipeStatementKindView | null;
    readonly attestedFromPerson: boolean;
}): boolean {
    return input.statementKind === 'fromPerson' || (input.statementKind === null && input.attestedFromPerson);
}
