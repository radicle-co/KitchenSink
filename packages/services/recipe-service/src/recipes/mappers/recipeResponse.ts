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
import type { RecipeDetailNutrition, RecipePhoto } from '@kitchensink/recipe-core';

import type { IngredientRow } from '../../database/schema/index.js';
import { quantityFromColumns } from '../dal/quantityColumns.js';
import type { ListRecipeRow, RecipeAggregate } from '../dal/recipes.dal.js';
import type { IngredientLineView } from '../domain/ingredientLineView.js';
import type { RecipeIngredientResponse, RecipeResponse, RecipeSummaryResponse } from '../dto/recipeResponse.dto.js';
import { recipeRowToDomain } from './recipeRowToDomain.js';

/**
 * Map a persisted recipe line and its composed view to the wire `RecipeIngredient` shape. Pure.
 *
 * The view (`domain/ingredientLineView.ts`) carries everything derived by following the line's binding — its
 * name, live root id, variant, `hasVariants`, reason code, user-entered flag and final status — so this mapper states
 * only the line's own columns. It is REQUIRED: the recipe database stores no food names (plan 002 R9), so a line cannot be
 * rendered without the read that derived its view.
 *
 * @param row - The persisted line.
 * @param view - The line's composed view.
 * @returns The wire line.
 */
export function toIngredientResponse(row: IngredientRow, view: IngredientLineView): RecipeIngredientResponse {
    return {
        // The binding id, under the wire's continuous name (a binding replaced the old catalog row one for one).
        ingredientId: row.foodLookupId,
        ...(view.name === undefined ? {} : { name: view.name }),
        ...(view.foodId === undefined ? {} : { foodId: view.foodId }),
        ...(view.variant === undefined ? {} : { variant: view.variant }),
        ...(view.hasVariants === undefined ? {} : { hasVariants: view.hasVariants }),
        ...(view.unresolvedReason === undefined ? {} : { unresolvedReason: view.unresolvedReason }),
        // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
        quantity: quantityFromColumns(row),
        ...(row.unit.length > 0 ? { unit: row.unit } : {}),
        ...(row.displayText !== null ? { notes: row.displayText } : {}),
        // U26/U27 — omitted for `NULL`, NEVER emitted as `''`: `recipeIngredientViewSchema` rejects a blank.
        // ⛔ `preparation` is its own key beside `name`, never folded into it.
        ...(row.preparation !== null ? { preparation: row.preparation } : {}),
        ...(row.groupLabel !== null ? { groupLabel: row.groupLabel } : {}),
        isUserEntered: view.isUserEntered,
        ...(view.resolutionStatus === undefined ? {} : { resolutionStatus: view.resolutionStatus }),
    };
}

/** Optional projection extras layered onto a recipe response by the caller (detail vs. list). */
export interface RecipeResponseExtras {
    /** Embedded photos (DETAIL reads only) — omitted on list/search metadata. */
    photos?: RecipePhoto[];
    /** Per-serving nutrition (DETAIL reads only) — omitted on list/search metadata. */
    nutrition?: RecipeDetailNutrition;
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
 * The recipe-level fields every projection shares, from the canonical {@link recipeRowToDomain} Data Mapper,
 * plus the optional extras. Pure.
 *
 * `description` is the ONE base field NOT taken from the canonical mapper: `RecipeResponse.description` is
 * optional and OMITTED when unset, whereas the canonical `Recipe.description` is required and defaults to `''`.
 */
function toRecipeBase(recipe: RecipeAggregate['recipe'], extras: RecipeResponseExtras): RecipeSummaryResponse {
    const { description: _canonicalDescription, ...base } = recipeRowToDomain(recipe);

    return {
        ...base,
        ...(recipe.description !== null ? { description: recipe.description } : {}),
        // The viewer's OWN rating — detail reads only, and only when the viewer has rated.
        ...(extras.viewerRating !== undefined ? { viewerRating: extras.viewerRating } : {}),
        // Cover photo (FR-001c) — absent when the recipe has no photos.
        ...(extras.coverPhotoUrl !== undefined ? { coverPhotoUrl: extras.coverPhotoUrl } : {}),
        // Embedded photos + per-serving nutrition for the detail read (absent on list/search metadata).
        ...(extras.photos !== undefined ? { photos: extras.photos } : {}),
        ...(extras.nutrition !== undefined ? { nutrition: extras.nutrition } : {}),
    };
}

/**
 * Map a persisted recipe aggregate to the DETAIL wire response: the recipe plus its composed lines and steps.
 * Pure.
 *
 * ⛔ `lineViews` is REQUIRED, one per line (by the line's row id): a line's name and status come from the read
 * that composed its view, and the database stores no food names (plan 002 R9). Keyed on the row id, not the
 * binding id, because two lines of one recipe may share a binding with different quantities, and so different
 * verdicts.
 *
 * @param aggregate - The recipe, its steps and its lines.
 * @param lineViews - Each line's composed view, by line row id.
 * @param extras - Detail-only extras.
 * @returns The detail response.
 * @throws {Error} when a line has no view — a defect in the read that composed them.
 */
export function toRecipeResponse(
    aggregate: RecipeAggregate,
    lineViews: ReadonlyMap<string, IngredientLineView>,
    extras: RecipeResponseExtras = {},
): RecipeResponse {
    const { recipe, steps, ingredients } = aggregate;

    return {
        ...toRecipeBase(recipe, extras),
        // In author order (`sortOrder`). Empty only when the recipe genuinely has no lines.
        ingredients: ingredients.map((row) => {
            const view = lineViews.get(row.id);

            if (view === undefined) {
                throw new Error(`recipe ${recipe.id} line ${row.id} has no composed view`);
            }

            return toIngredientResponse(row, view);
        }),
        steps: steps.map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
    };
}

/**
 * Map a list row to the published LIST item (`recipeSchema`): the recipe's metadata and cover, with no steps
 * and no lines, which the published item does not carry. Pure.
 *
 * @param row - The list row.
 * @param extras - The resolved cover URL.
 * @returns The list item.
 */
export function toRecipeSummaryResponse(row: ListRecipeRow, extras: RecipeResponseExtras = {}): RecipeSummaryResponse {
    return toRecipeBase(row.recipe, extras);
}
