/**
 * `make*` row fixtures for the Collections unit tests. Each accepts a `Partial` override and returns a
 * fully-populated Drizzle row (dates as real `Date`s, matching what `node-postgres` hands back), so the
 * service/DAL mapping and date→ISO conversion can be exercised without a database.
 */
import type { CollectionRow, RecipeCollectionRow } from '../../database/schema/collections.js';
import type { RecipeRow } from '../../database/schema/recipes.js';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

/** A `collections` row (owner `owner-1`, private, no clone provenance) with overridable fields. */
export function makeCollectionRow(overrides: Partial<CollectionRow> = {}): CollectionRow {
    return {
        id: '00000000-0000-4000-8000-0000000000c1',
        ownerId: 'owner-1',
        name: 'Weeknight Dinners',
        description: null,
        visibility: 'private',
        sourceCollectionId: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
        ...overrides,
    };
}

/** A `recipe_collections` membership row (`manual` provenance) with overridable fields. */
export function makeMembershipRow(overrides: Partial<RecipeCollectionRow> = {}): RecipeCollectionRow {
    return {
        collectionId: '00000000-0000-4000-8000-0000000000c1',
        recipeId: '00000000-0000-4000-8000-000000000001',
        addedAt: FIXED_DATE,
        addedVia: 'manual',
        ...overrides,
    };
}

/** A fully-populated active (non-tombstoned) `recipes` row with overridable fields. */
export function makeRecipeRow(overrides: Partial<RecipeRow> = {}): RecipeRow {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        ownerId: 'owner-1',
        title: 'Baseline Recipe',
        description: 'A seeded recipe.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        difficulty: null,
        averageRating: null,
        ratingCount: 0,
        visibility: 'public',
        sourceType: 'user_created',
        sourceUrl: null,
        sourceAttribution: null,
        clonedFromId: null,
        hasSubstantiveEdit: false,
        cuisine: null,
        dietaryFlags: [],
        tags: [],
        hasPartialNutrition: false,
        leadCaloriesPerServing: null,
        currentVersion: 1,
        ingredientNamesText: 'flour water salt',
        searchVector: null,
        deletedAt: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
        ...overrides,
    };
}
