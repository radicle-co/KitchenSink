/**
 * Typed `make*` fixture factories for the web collection-container tests. Each accepts `Partial<T>`
 * overrides over sensible defaults (constitution fixture convention). Kept local to the web app's tests so
 * they never depend on another package's (non-exported) fixtures.
 */
import type { CollectionWithRecipes } from '@commise/features-recipes';
import type { Collection, PaginatedResponse } from '@kitchensink/recipe-core';

import { makeRecipe } from './recipeFixtures';

/**
 * Build a complete {@link Collection} with sensible defaults.
 *
 * @param overrides - Fields to override on the default collection.
 * @returns A complete `Collection`.
 */
export function makeCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight dinners',
        description: 'Fast, comforting meals for busy nights.',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

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
