/**
 * The single authoritative representation of "may this viewer SEE this recipe?" — the read-side
 * authorization rule for an individual recipe (as distinct from the C-004 *write*-side policy in
 * {@link ./visibility-policy.ts}, which governs which visibility a recipe may HOLD).
 *
 * The rule (FR-003 / the collection-membership IDOR guard): a recipe is viewable by a principal iff it
 * is `public`, OR the principal owns it. Owners always see their own recipes (including `private`);
 * everyone else sees only `public` ones.
 *
 * This predicate is deliberately extracted because the same rule is enforced in multiple places —
 * `RecipesService.getById`, and both collection read paths (add-to-collection and list-collection-
 * recipes). A security boundary re-encoded per call site drifts silently (a leak the tests may not
 * catch); one pure, tested function keeps every enforcement point in lockstep. Pure — inputs only.
 */

/** The minimal recipe shape the viewability rule needs — structural, so it accepts any row/domain type. */
export interface ViewableRecipeFields {
    /** The recipe's owner (app-user ULID). */
    readonly ownerId: string;
    /** The recipe's visibility literal (`public` | `private`). */
    readonly visibility: string;
}

/**
 * Whether `viewerId` is authorized to see `recipe`: true iff the recipe is public or the viewer owns it.
 * Pure.
 */
export function isRecipeViewableBy(recipe: ViewableRecipeFields, viewerId: string): boolean {
    return recipe.visibility === 'public' || recipe.ownerId === viewerId;
}
