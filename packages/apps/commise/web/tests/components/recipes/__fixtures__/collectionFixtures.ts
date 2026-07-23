/**
 * Typed `make*` fixture factories for the web collection-container tests. `makeCollection` is the shared,
 * invariant-deriving Object Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported here so
 * consuming tests keep importing from this local module. `makeCollectionWithRecipes`/`makeCollectionsPage`
 * stay web-local: they compose in the web-only `CollectionWithRecipes` type / are pagination-envelope
 * helpers, not pure-domain wire-contract fixtures.
 */
import { makeCollection, makeRecipe } from '@kitchensink/recipe-core/testing';
import type { Collection, PaginatedResponse } from '@kitchensink/recipe-core';

import type { CollectionWithRecipes } from '@commise/features-recipes';

export { makeCollection };

/**
 * Build a {@link CollectionWithRecipes} (a collection plus its member recipes).
 *
 * @param overrides - Fields to override on the default collection-with-recipes.
 * @returns A complete `CollectionWithRecipes`.
 */
export function makeCollectionWithRecipes(overrides: Partial<CollectionWithRecipes> = {}): CollectionWithRecipes {
    return {
        ...makeCollection(),
        recipes: [
            makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
            makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }),
        ],
        ...overrides,
    };
}

/**
 * Build a {@link PaginatedResponse} page of collections.
 *
 * @param collections - The collections on the page.
 * @param overrides - Envelope fields to override.
 * @returns A complete paginated page.
 */
export function makeCollectionsPage(
    collections: readonly Collection[],
    overrides: Partial<Omit<PaginatedResponse<Collection>, 'data'>> = {},
): PaginatedResponse<Collection> {
    return {
        data: [...collections],
        total: collections.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        ...overrides,
    };
}
