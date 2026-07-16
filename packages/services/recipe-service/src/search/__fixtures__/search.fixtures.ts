/**
 * Fixture factories for the recipe-search domain (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 * Used by the search DAL / service / controller unit tests.
 *
 * The search DAL reads via `db.execute` and maps raw (snake_case) `recipes` rows to the shared domain
 * `Recipe` — so the raw-row factory here mirrors {@link makeRawIngredientRow} in the ingredients vertical.
 */
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';

/** A raw (snake_case) `recipes` row as projected by the search DAL's `db.execute`, with overrides. */
export function makeRawRecipeSearchRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        id: '00000000-0000-4000-8000-00000000a001',
        owner_id: '01J000000000000000000FREE0',
        title: 'Weeknight Pasta',
        description: 'A quick tomato pasta.',
        prep_time_minutes: 10,
        cook_time_minutes: 20,
        total_time_minutes: 30,
        servings: 4,
        difficulty: null,
        average_rating: null,
        rating_count: 0,
        visibility: 'public',
        source_type: 'user_created',
        source_url: null,
        source_attribution: null,
        cloned_from_id: null,
        has_substantive_edit: false,
        cuisine: 'italian',
        dietary_flags: ['vegetarian'],
        tags: ['dinner', 'quick'],
        has_partial_nutrition: false,
        current_version: 1,
        ingredient_names_text: 'pasta tomato garlic',
        deleted_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        cover_photo_key: null,
        rank: 0.75,
        ...overrides,
    };
}

/** A raw facet-aggregation row (`{ facet, value, count }`) as returned by the facet CTE. */
export function makeRawFacetRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        facet: 'dietary_flags',
        value: 'vegetarian',
        count: 3,
        ...overrides,
    };
}

/** A shared-domain {@link Recipe} for search-result assertions. */
export function makeSearchRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: '00000000-0000-4000-8000-00000000a001',
        ownerId: '01J000000000000000000FREE0',
        title: 'Weeknight Pasta',
        description: 'A quick tomato pasta.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'public',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        cuisine: 'italian',
        dietaryFlags: ['vegetarian'],
        tags: ['dinner', 'quick'],
        hasPartialNutrition: false,
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

/** A single ranked {@link RecipeSearchResult} hit. */
export function makeSearchResult(overrides: Partial<RecipeSearchResult> = {}): RecipeSearchResult {
    return {
        recipe: makeSearchRecipe(),
        rank: 0.75,
        ...overrides,
    };
}
