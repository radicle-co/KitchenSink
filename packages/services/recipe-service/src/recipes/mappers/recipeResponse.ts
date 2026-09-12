/**
 * @module recipe-service/recipes/mappers — the persisted recipe aggregate → its PUBLISHED wire shape.
 *
 * A Data Mapper, and the sibling of {@link recipeRowToDomain} — which it delegates the base projection to
 * rather than restating it. Pure: everything it needs arrives as a parameter, so it knows nothing of DI, the
 * food service, verdicts, or photos-as-I/O.
 *
 * ⚠️ Lifted OUT of `recipes.service.ts` unchanged. It sits here because BOTH the detail assembler and
 * `RecipesService.list` project through it; leaving it on the service would have made the assembler import
 * the orchestrator to render a response, inverting the dependency direction.
 */
import type { LineResolutionStatus, RecipeNutrition, RecipePhoto } from '@kitchensink/recipe-core';

import type { RecipeIngredientRow } from '../../database/schema/index.js';
import { quantityFromColumns } from '../dal/quantityColumns.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';
import type { RecipeIngredientResponse, RecipeResponse } from '../dto/recipeResponse.dto.js';
import { recipeRowToDomain } from './recipeRowToDomain.js';

/**
 * Map a persisted `recipe_ingredients` link row to the wire `RecipeIngredient` shape. Pure.
 *
 * `resolutionStatus` (U14) is layered on by the DETAIL read alone and is OMITTED everywhere else — a list
 * or search projection has performed neither the catalog load nor the verdict read, and emitting a default
 * there would state a resolution fact nobody looked up.
 */
export function toIngredientResponse(
    row: RecipeIngredientRow,
    resolutionStatus: LineResolutionStatus | undefined,
): RecipeIngredientResponse {
    return {
        ingredientId: row.ingredientId,
        name: row.ingredientName,
        // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
        quantity: quantityFromColumns(row),
        ...(row.unit.length > 0 ? { unit: row.unit } : {}),
        ...(row.displayText !== null ? { notes: row.displayText } : {}),
        // U26/U27 — omitted for `NULL`, NEVER emitted as `''`: `recipeIngredientViewSchema` rejects a blank
        // (`min(1)`), so a body carrying one is a body this server can write and no client can read.
        // ⛔ `preparation` is its own key beside `name`, never folded into it — the name is what the catalog
        // says the food IS, this is what the recipe does to it.
        ...(row.preparation !== null ? { preparation: row.preparation } : {}),
        ...(row.groupLabel !== null ? { groupLabel: row.groupLabel } : {}),
        isUserEntered: row.isUserEntered,
        ...(resolutionStatus === undefined ? {} : { resolutionStatus }),
    };
}

/** Optional projection extras layered onto a recipe response by the caller (detail vs. list). */
export interface RecipeResponseExtras {
    /** Embedded photos (DETAIL reads only) — omitted on list/search metadata. */
    photos?: RecipePhoto[];
    /** Per-serving nutrition (DETAIL reads only) — omitted on list/search metadata. */
    nutrition?: RecipeNutrition;
    /**
     * Per-LINE resolution status by `recipe_ingredients` row id (U14, DETAIL reads only).
     *
     * ⛔ Keyed on the row id and NOT the ingredient id: two lines of one recipe may reference the same
     * catalog ingredient with different quantities, which are two different judgements and may carry two
     * different verdicts. Keying on the ingredient would silently badge both lines from one of them.
     */
    lineStatuses?: ReadonlyMap<string, LineResolutionStatus>;
    /** Absolute CDN URL of the cover photo (FR-001c). Resolved by the caller (list LATERAL / detail photos). */
    coverPhotoUrl?: string;
    /**
     * The VIEWER's own rating (1–5), for the `RecipeDetail.viewerRating` field (FR-013). DETAIL reads only,
     * and only when the viewer has actually rated — ABSENT otherwise (never `0`). Resolved by the caller
     * (`getById`) from the viewer-scoped `recipe_ratings` row.
     */
    viewerRating?: number;
    /*
     * ⛔ THERE IS NO `derivedNutrition` EXTRA, and reintroducing one is how the drift comes back.
     *
     * It carried `leadCaloriesPerServing` into the base projection, and the only path that ever set it was
     * `toDetailResponse` — from the SAME `computeDetailNutrition` result it already emits as `nutrition`.
     * So the detail body reported one number twice, under two names, with nothing keeping them in step
     * (ADR-0021's "Follow-up owed"). The detail's figure is `nutrition`; a card's is
     * `POST /api/v1/recipes/nutrition-batch`, whose union can say "measured zero" and "unaccounted"
     * separately — which an optional number never could.
     */
}

/**
 * Map a persisted recipe aggregate to the wire response. Pure. On the single-recipe DETAIL reads the
 * caller passes the embedded `photos` + per-serving `nutrition` so the client renders the whole recipe in
 * one round-trip; on list/search metadata reads both are omitted (their keys are absent).
 *
 * The base recipe-level fields (S-R4) come from the canonical {@link recipeRowToDomain} Data Mapper — the
 * SAME `difficulty` (omitted when unstated), trigger-maintained `averageRating`/`ratingCount` (average
 * omitted when unrated — never `0`), and derived `usesPremiumCapability` (via the single authoritative
 * `recipe-core` fn) that the collections/search projections share. This function then layers the
 * `RecipeResponse` SUPERSET on top: `ingredients`/`steps` (always), and `viewerRating`/`coverPhotoUrl`/
 * `photos`/`nutrition` via {@link RecipeResponseExtras} (the two read paths resolve `coverPhotoUrl`
 * differently — list via a cover LATERAL, detail from the first embedded photo).
 *
 * `description` is the ONE base field NOT taken from the canonical mapper: `RecipeResponse.description`
 * is optional and OMITTED when unset, whereas the canonical `Recipe.description` is required and defaults
 * to `''` — a genuinely different wire rule (not a duplicate to collapse), so it is re-derived here from
 * the raw row, exactly as before.
 */
export function toRecipeResponse(aggregate: RecipeAggregate, extras: RecipeResponseExtras = {}): RecipeResponse {
    const { recipe, steps, ingredients } = aggregate;
    // `description` is excluded from the canonical base (see the doc comment above) and re-applied below
    // under RecipeResponse's own omit-when-null rule.
    // The base projection carries NO nutrition of any kind — the mapper has no input for one. A recipe with
    // no nutrition fields is what "we did not look it up" honestly looks like; the pinned
    // `hasPartialNutrition: true` that used to stand here claimed "partial", a different fact.
    const { description: _canonicalDescription, ...base } = recipeRowToDomain(recipe);

    return {
        ...base,
        // RecipeResponse.description is OPTIONAL — OMITTED (not `''`) when unset, unlike the canonical
        // Recipe.description (required, `''` default).
        ...(recipe.description !== null ? { description: recipe.description } : {}),
        // Composed from the `recipe_ingredients` junction (persisted atomically with the recipe), in
        // author order (`sortOrder`). Empty only when the recipe genuinely has no ingredient lines.
        ingredients: ingredients.map((row) => toIngredientResponse(row, extras.lineStatuses?.get(row.id))),
        steps: steps.map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
        // The viewer's OWN rating (per-viewer, distinct from the community average) — present only on the
        // detail read and only when the viewer has rated; OMITTED (not `0`) otherwise. The caller resolves
        // it viewer-scoped, so it can only ever be THIS viewer's stars.
        ...(extras.viewerRating !== undefined ? { viewerRating: extras.viewerRating } : {}),
        // Cover photo (FR-001c) — absent when the recipe has no photos.
        ...(extras.coverPhotoUrl !== undefined ? { coverPhotoUrl: extras.coverPhotoUrl } : {}),
        // Embedded photos + per-serving nutrition for the detail read (absent on list/search metadata).
        ...(extras.photos !== undefined ? { photos: extras.photos } : {}),
        ...(extras.nutrition !== undefined ? { nutrition: extras.nutrition } : {}),
    };
}
