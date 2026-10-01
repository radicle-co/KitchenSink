/**
 * The single authoritative representation of "may this viewer SEE this recipe?" — the read-side
 * authorization rule for an individual recipe (as distinct from the C-004 *write*-side policy in
 * `./visibilityPolicy.ts`, which governs which visibility a recipe may HOLD).
 *
 * The rule (FR-003 / W8-a.3 / the collection-membership IDOR guard): a recipe is viewable by a principal
 * iff the principal OWNS it, OR it is BOTH `public` AND `published`. Owners always see their own recipes
 * (including `private` and `draft`); everyone else sees only public, published ones. The draft term is a
 * SECURITY boundary (decision 5) — a free-tier draft is `visibility='public'`, so the visibility clause
 * alone would leak it.
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
    /**
     * The recipe's publication status literal (`draft` | `published`) — W8-a.3. REQUIRED: a caller that
     * forgets to SELECT `status` into the row would otherwise silently regress the draft boundary, so the
     * type forces every enforcement point to supply it.
     */
    readonly status: string;
}

/**
 * Whether `viewerId` is authorized to see `recipe`: true iff the viewer OWNS it, OR it is both `public`
 * AND `published`. The draft term (W8-a.3) is orthogonal to visibility — a public draft is owner-only. Pure.
 */
export function isRecipeViewableBy(recipe: ViewableRecipeFields, viewerId: string): boolean {
    return recipe.ownerId === viewerId || (recipe.visibility === 'public' && recipe.status === 'published');
}
