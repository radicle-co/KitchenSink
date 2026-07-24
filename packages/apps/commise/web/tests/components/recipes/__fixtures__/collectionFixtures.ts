/**
 * Typed `make*` fixture factories for the web collection-container tests. `makeCollection` is the shared,
 * invariant-deriving Object Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported here so
 * consuming tests keep importing from this local module. `makeCollectionWithRecipes`/`makeCollectionsPage`
 * stay web-local: pagination-envelope / mock-seed helpers, not pure-domain wire-contract fixtures.
 *
 * `makeCollectionWithRecipes` builds the CLIENT's `CollectionWithRecipes` (`@kitchensink/recipe-service-client`,
 * W5 Task 5), NOT the presentational `@commise/features-recipes` one — its only consumer,
 * `CollectionDetailContainer.test.tsx`, uses it exclusively to seed `client.getCollectionById`'s mocked
 * resolution, so it must match what that method actually returns (each member now REQUIRES `addedVia`).
 */
import { makeCollection, makeRecipe } from '@kitchensink/recipe-core/testing';
import type { Collection, PaginatedResponse } from '@kitchensink/recipe-core';

import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';

export { makeCollection };

/**
 * Build a {@link CollectionWithRecipes} (a collection plus its member recipes, each with its provenance).
 *
 * @param overrides - Fields to override on the default collection-with-recipes.
 * @returns A complete `CollectionWithRecipes`.
 */
export function makeCollectionWithRecipes(overrides: Partial<CollectionWithRecipes> = {}): CollectionWithRecipes {
    return {
        ...makeCollection(),
        recipes: [
            { ...makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }), addedVia: 'manual' },
            { ...makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }), addedVia: 'manual' },
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
