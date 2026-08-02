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
 * @implements FR-007 FR-007a
 */
import type { Ingredient } from '@kitchensink/recipe-core';

/**
 * Whether the food-service catalog contributed to a blend, and if not, why (F2). Distinct kinds because the
 * caller renders them differently: `unavailable` is a transient degradation worth telling the user about,
 * `disabled` is an operator decision that must NOT surface as an error.
 */
export type CatalogAvailability = 'ok' | 'unavailable' | 'disabled';

/** One food-service catalog hit, normalized (non-null trimmed name) for the blend. */
export interface CatalogHit {
    /** The opaque food-service internal id — `SearchResultView.id` IS the `food_id`. */
    readonly foodId: string;
    /** The golden display name (never null/blank; the gateway drops unrenderable hits). */
    readonly name: string;
    /** food-service's relevance score (higher is better). */
    readonly score: number;
}

/**
 * One blended typeahead suggestion. Discriminated on `provenance` so a consumer renders it with an
 * exhaustive `switch` and can never treat a not-yet-admitted catalog hit as a pickable ingredient row.
 */
export type IngredientSuggestion =
    | {
          /** A real `ingredients` row — pickable as-is. */
          readonly provenance: 'local';
          /** The catalog row, with any nutrition it already carries. */
          readonly ingredient: Ingredient;
      }
    | {
          /** A food-service golden record with no `ingredients` row yet — must be admitted on pick. */
          readonly provenance: 'catalog';
          /** The opaque `food_id` to admit via `POST /api/v1/ingredients/by-food`. */
          readonly foodId: string;
          /** The golden display name. */
          readonly name: string;
          /** food-service's relevance score. */
          readonly score: number;
      };

/** The `GET /api/v1/ingredients/suggest` response envelope. */
export interface IngredientSuggestions {
    /** The blended, deduped, sectioned suggestions (local section first). */
    readonly suggestions: readonly IngredientSuggestion[];
    /** Whether the food catalog contributed (F2) — lets the picker say so instead of silently showing less. */
    readonly catalogAvailability: CatalogAvailability;
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

    const localSection: IngredientSuggestion[] = [...local, ...promotedOrdered]
        .slice(0, limit)
        .map((ingredient) => ({ provenance: 'local', ingredient }));

    const catalogSection: IngredientSuggestion[] = catalogHits
        .filter((hit) => !linkedFoodIds.has(hit.foodId))
        .slice(0, limit)
        .map((hit) => ({ provenance: 'catalog', foodId: hit.foodId, name: hit.name, score: hit.score }));

    return [...localSection, ...catalogSection];
}
