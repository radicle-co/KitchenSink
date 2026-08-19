/**
 * Stage 2 — the blended ingredient-typeahead view shape and the PURE reduction that produces it.
 *
 * **Why this exists.** Until Stage 2 the ingredient typeahead queried ONLY the recipe-service `ingredients`
 * table — rows that have already been *used* in a recipe — so the ~8k lab-analyzed golden records Stage 1
 * seeded into food-service's `food` catalog were invisible until somebody add-by-named them. Stage 2 blends
 * the food catalog in. The result set therefore contains two structurally DIFFERENT things, which is why the
 * wire shape is a **discriminated union** rather than a widened `Ingredient`:
 *
 *  - `local` — a real `ingredients` row. Its `id` IS a valid `recipe_ingredients.ingredient_id`, so the
 *    picker can put it on a recipe line immediately, with whatever nutrition the row already carries.
 *  - `catalog` — a food-service golden record with **no `ingredients` row yet**. It has NO ingredient id and
 *    (per `SearchResultView`) NO nutrition; picking it must first ADMIT it into the catalog
 *    (`POST /api/v1/ingredients/by-food`, which creates the row and backfills nutrition in one round-trip).
 *
 * Collapsing those into one shape would force a fabricated ingredient id — the exact class of bug that ends
 * with a foreign-key violation or a nutrition-less recipe line. Parse, don't validate: the union makes the
 * illegal state ("pick a catalog hit as if it were a catalog row") unrepresentable.
 *
 * **Section, don't blend** (the command-palette pattern — Linear/Slack/Raycast, and the plan's §1c UX
 * research): the familiar local section renders first and is never reordered or interleaved by the catalog
 * section that follows it. That is a structural, not cosmetic, choice — it removes the layout-shift class of
 * jank entirely, and it survives the catalog section being empty (F2 degradation) with no visible reflow.
 *
 * WHERE THE WIRE TYPES LIVE. `CatalogAvailability`, `IngredientSuggestion` and the response envelope are
 * AUTHORED as zod in `ingredients.schema.ts` and re-exported here, so the shape this reduction produces and the
 * shape `@kitchensink/schema-recipe` publishes cannot be two things. This file used to declare them, which made
 * a pure helper the authority for a public response body — the same inversion `search.schema.ts` records
 * fixing. `CatalogHit` and `BlendSuggestionsInput` stay here: they are this function's INPUT, never on the
 * wire.
 *
 * @implements FR-007 FR-007a
 */
import type { Ingredient } from '@kitchensink/recipe-core';

export type {
    CatalogAvailability,
    IngredientSuggestion,
    IngredientSuggestionsResponse as IngredientSuggestions,
} from './ingredients.schema.js';
import type { IngredientSuggestion } from './ingredients.schema.js';

/** One food-service catalog hit, normalized (non-null trimmed name) for the blend. */
export interface CatalogHit {
    /** The opaque food-service internal id — `SearchResultView.id` IS the `food_id`. */
    readonly foodId: string;
    /** The golden display name (never null/blank; the gateway drops unrenderable hits). */
    readonly name: string;
    /** food-service's relevance score (higher is better). */
    readonly score: number;
}

/** The facts {@link blendIngredientSuggestions} reduces into one sectioned, deduped suggestion list. */
export interface BlendSuggestionsInput {
    /** The recipe-local DAL search hits, in the order the DAL/ranking chose. */
    readonly local: readonly Ingredient[];
    /**
     * `ingredients` rows found by `food_id` for the catalog hits — foods that DO already have a catalog row
     * even though the recipe-local text search missed them. They belong in the familiar section.
     */
    readonly promoted: readonly Ingredient[];
    /** The catalog hits, already ranked by the gateway (best first). */
    readonly catalogHits: readonly CatalogHit[];
    /** Max suggestions PER SECTION (see {@link blendIngredientSuggestions}). */
    readonly limit: number;
}

/**
 * Blend, dedup and section the two catalogs into one suggestion list. Pure — returns a new array and never
 * mutates its inputs.
 *
 * **The invariant:** a food that already has an `ingredients` row appears EXACTLY ONCE, as a `local`
 * suggestion. Dedup is on the opaque `food_id` (Stage 2's locked rule), computed over local **and** promoted
 * rows BEFORE the per-section cap — so a row squeezed out by the cap is dropped outright rather than
 * reappearing lower down under a different provenance. Bounded, never duplicated.
 *
 * A freeform (no `food_id`) row that merely shares a NAME with a catalog hit is deliberately NOT deduped:
 * they are different things (the user's own nutrition-less row vs the golden record), the provenance
 * sections/badges distinguish them, and fuzzy-name reconciliation is a later refinement, not Stage 2.
 *
 * **Ordering.** `[local text hits (as given)] → [promoted rows, by catalog score] → [catalog hits (as given)]`.
 * Promoted rows sort by their food's catalog score because that is the only relevance signal they have — the
 * local text search, by definition, did not match them.
 *
 * **Limit** applies PER SECTION, not to the total: the sections are rendered as separate lists, so capping
 * them together would let a full local section squeeze the catalog section out entirely — the precise failure
 * Stage 2 exists to fix.
 *
 * @param input - The two catalogs' hits plus the per-section cap.
 * @returns The sectioned, deduped suggestions (local section first).
 */
/**
 * The comparison key for "these two suggestions name the same thing".
 *
 * Case- and whitespace-insensitive ONLY. Deliberately not a stemmer, a synonym table or a fuzzy match: this
 * decides whether a user's own row is hidden from them, so a false positive silently removes a real choice.
 * "Butter" vs "  BUTTER " is the same ingredient; "Grandma's browned butter blend" is not, and must survive.
 *
 * @param name - A suggestion's display name.
 * @returns The normalized comparison key.
 */
function normalizeSuggestionName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function blendIngredientSuggestions(input: BlendSuggestionsInput): IngredientSuggestion[] {
    const { local, promoted, catalogHits, limit } = input;

    if (limit <= 0) {
        return [];
    }

    // Score index of each catalog hit — the only relevance signal a promoted row has (see the docstring).
    const rankByFoodId = new Map(catalogHits.map((hit, index) => [hit.foodId, index]));
    const localIds = new Set(local.map((ingredient) => ingredient.id));

    // Sorted on a copy — `promoted` belongs to the caller.
    const promotedOrdered = [...promoted]
        .filter((ingredient) => !localIds.has(ingredient.id))
        .sort(
            (a, b) =>
                (rankByFoodId.get(a.foodId ?? '') ?? Number.MAX_SAFE_INTEGER) -
                (rankByFoodId.get(b.foodId ?? '') ?? Number.MAX_SAFE_INTEGER),
        );

    // Computed over the UNCAPPED familiar set so the cap can never resurrect a food as a catalog hit.
    const linkedFoodIds = new Set(
        [...local, ...promotedOrdered].flatMap((ingredient) =>
            ingredient.foodId === undefined ? [] : [ingredient.foodId],
        ),
    );

    // ⛔ THE CATALOG SECTION IS COMPUTED FIRST, because the freeform suppression below may only read hits
    // that will actually be RENDERED. Suppressing a freeform row against a hit the cap then slices away
    // would leave the user with NEITHER — strictly worse than the shadowing this fixes.
    const catalogSection: IngredientSuggestion[] = catalogHits
        .filter((hit) => !linkedFoodIds.has(hit.foodId))
        .slice(0, limit)
        .map((hit) => ({ provenance: 'catalog', foodId: hit.foodId, name: hit.name, score: hit.score }));

    // ⛔ A CATALOG MATCH BEATS A FREEFORM ROW OF THE SAME NAME (owner ruling, 2026-08-19).
    //
    // Dedup above is by `food_id`, and a FREEFORM row has none — so it contributed nothing to
    // `linkedFoodIds`, both rows survived, and the freeform one won purely because this section renders
    // first. Measured consequence: importing 338 public-domain recipes through the app's own resolution path
    // produced 268 lines with no food record, and ALL 268 were pre-existing freeform rows ("Butter" alone was
    // 138). A catalog-backed butter existed in the same table and lost every time. The shadow was permanent:
    // once a freeform "butter" exists, butter could never acquire USDA nutrition for anyone.
    //
    // ⚠️ This does NOT weaken "section, don't blend". That rule is an ANTI-JANK LAYOUT guarantee — the local
    // section is still never reordered or interleaved by the catalog section. Only a row that a visible
    // catalog hit makes redundant is removed, so neither section changes shape.
    //
    // A catalog-BACKED local row is untouched: it already links the food, and picking it needs no
    // `by-food` admission round-trip, so it remains the better option and keeps suppressing the hit.
    const renderedCatalogNames = new Set(
        catalogSection.flatMap((suggestion) =>
            suggestion.provenance === 'catalog' ? [normalizeSuggestionName(suggestion.name)] : [],
        ),
    );

    const localSection: IngredientSuggestion[] = [...local, ...promotedOrdered]
        .filter(
            (ingredient) =>
                ingredient.foodId !== undefined || !renderedCatalogNames.has(normalizeSuggestionName(ingredient.name)),
        )
        .slice(0, limit)
        .map((ingredient) => ({ provenance: 'local', ingredient }));

    return [...localSection, ...catalogSection];
}
