/**
 * Typed `make*` fixture factories for the web public-discovery container tests (T076). Each accepts
 * `Partial<T>` overrides over sensible defaults (constitution fixture convention) and builds on the shared
 * `makeRecipe` factory. Kept local to the web app's tests so they never depend on another package's
 * (non-exported) fixtures.
 */
import type { RecipeSearchResult } from '@kitchensink/recipe-core';
import type { RecipeSearchResponse } from '@kitchensink/recipe-service-client';

import { makeRecipe } from './recipeFixtures';

/**
 * Build a single {@link RecipeSearchResult} envelope with a default public recipe.
 *
 * @param overrides - Fields to override on the default search result.
 * @returns A complete `RecipeSearchResult`.
 */
export function makeSearchResult(overrides: Partial<RecipeSearchResult> = {}): RecipeSearchResult {
    return {
        recipe: makeRecipe(),
        ...overrides,
    };
}

/**
 * Build a {@link RecipeSearchResponse} envelope wrapping the given results.
 *
 * @param results - The search-result hits on the page.
 * @param overrides - Envelope fields to override.
 * @returns A complete `RecipeSearchResponse`.
 */
export function makeSearchResponse(
    results: readonly RecipeSearchResult[],
    overrides: Partial<Omit<RecipeSearchResponse, 'results'>> = {},
): RecipeSearchResponse {
    return {
        results: [...results],
        total: results.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        facets: {},
        ...overrides,
    };
}
