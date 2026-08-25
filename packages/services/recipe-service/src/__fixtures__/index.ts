/**
 * T082 — backend fixture factories for the recipe service's unit + integration tests.
 *
 * `make*` factories accept a `Partial<T>` of overrides and return a fully-populated value, so a test
 * only states the fields it cares about (per CODING_STANDARDS fixture-factory convention). Two shapes
 * are provided: the persistence rows (`makeRecipeRow` / `makeVersionRow` — what the DAL returns) and
 * the shared domain `Recipe` (`makeRecipe` — the wire/domain contract from `@kitchensink/recipe-core`).
 */
import type { Recipe } from '@kitchensink/recipe-core';

import type {
    RecipeIngredientRow,
    RecipePhotoRow,
    RecipeRow,
    RecipeStepRow,
    RecipeVersionRow,
} from '../database/schema/index.js';

/** Stable base timestamps so equality assertions are deterministic. */
const BASE_DATE = new Date('2026-01-01T00:00:00.000Z');

/**
 * A persisted `recipes` row (as Drizzle selects it — `Date` timestamps, nullable optionals).
 * Owner defaults to a fixed app-user ULID; override `ownerId` to exercise ownership paths.
 */
export function makeRecipeRow(overrides: Partial<RecipeRow> = {}): RecipeRow {
    return {
        id: '00000000-0000-4000-8000-00000000a001',
        ownerId: '01J000000000000000000FREE0',
        title: 'Test Recipe',
        description: 'A recipe used in tests.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        difficulty: null,
        averageRating: null,
        ratingCount: 0,
        visibility: 'public',
        status: 'published',
        sourceType: 'user_created',
        sourceUrl: null,
        sourceAttribution: null,
        clonedFromId: null,
        hasSubstantiveEdit: false,
        cuisine: 'italian',
        dietaryFlags: [],
        tags: ['dinner'],
        authorHandle: null,
        currentVersion: 1,
        ingredientNamesText: 'flour water salt',
        searchVector: null,
        deletedAt: null,
        createdAt: BASE_DATE,
        updatedAt: BASE_DATE,
        ...overrides,
    };
}

/** A persisted `recipe_steps` row. */
export function makeRecipeStepRow(overrides: Partial<RecipeStepRow> = {}): RecipeStepRow {
    return {
        id: '00000000-0000-4000-8000-00000000b001',
        recipeId: '00000000-0000-4000-8000-00000000a001',
        stepNumber: 1,
        instruction: 'Mix the ingredients.',
        timerSeconds: null,
        ...overrides,
    };
}

/** A persisted `recipe_ingredients` junction row (numeric columns arrive as strings from Drizzle/pg). */
export function makeRecipeIngredientRow(overrides: Partial<RecipeIngredientRow> = {}): RecipeIngredientRow {
    return {
        id: '00000000-0000-4000-8000-00000000d001',
        recipeId: '00000000-0000-4000-8000-00000000a001',
        ingredientId: '00000000-0000-4000-8000-0000000000ff',
        quantity: '1',
        /** `null` = "this line states one value, not two" — the shape of every row 0020 did not touch. */
        quantityHigh: null,
        unit: 'unit',
        displayText: null,
        /** `null` = "this line was AUTHORED, not transcribed" — the shape of every row 0024 did not touch. */
        sourceLine: null,
        /**
         * All three `null` = "this line's quantity and unit are what the SOURCE said" — the shape of every
         * row 0027 did not touch, and of every line that stated a modern unit.
         */
        statedQuantity: null,
        statedQuantityHigh: null,
        statedUnit: null,
        /**
         * Both `null` = "this line states no preparation and belongs to no section" — the shape of every row
         * 0030 did not touch, and of the overwhelming majority of lines a cook will ever write.
         */
        preparation: null,
        groupLabel: null,
        sortOrder: 0,
        ingredientName: 'Test Ingredient',
        isUserEntered: false,
        userCalories: null,
        userProteinG: null,
        userCarbsG: null,
        userFatG: null,
        ...overrides,
    };
}

/** A persisted `recipe_versions` row (T013 snapshot history). */
export function makeVersionRow(overrides: Partial<RecipeVersionRow> = {}): RecipeVersionRow {
    return {
        id: '00000000-0000-4000-8000-00000000c001',
        recipeId: '00000000-0000-4000-8000-00000000a001',
        versionNumber: 1,
        snapshot: { title: 'Test Recipe' },
        baseVersion: null,
        s3Key: null,
        createdBy: '01J000000000000000000FREE0',
        changeSummary: null,
        deviceLabel: null,
        editorHandle: null,
        createdAt: BASE_DATE,
        ...overrides,
    };
}

/** The shared domain {@link Recipe} contract (ISO date strings), for service/response-shape tests. */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: '00000000-0000-4000-8000-00000000a001',
        ownerId: '01J000000000000000000FREE0',
        title: 'Test Recipe',
        // Derived, not stored (U10). The fixture states the honest default: not accounted for.
        description: 'A recipe used in tests.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'public',
        status: 'published',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        cuisine: 'italian',
        dietaryFlags: [],
        tags: ['dinner'],
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: BASE_DATE.toISOString(),
        updatedAt: BASE_DATE.toISOString(),
        ...overrides,
    };
}

/**
 * A persisted `recipe_photos` row (as Drizzle selects it). Photos carry a SINGLE stored object
 * (`s3Key`) served as-is via CloudFront — no variants, no processing state. `sizeBytes` is nullable in
 * the schema; the factory populates it so equality assertions are deterministic.
 */
export function makeRecipePhotoRow(overrides: Partial<RecipePhotoRow> = {}): RecipePhotoRow {
    return {
        id: '00000000-0000-4000-8000-00000000d001',
        recipeId: '00000000-0000-4000-8000-00000000a001',
        s3Key: 'recipes/01J000000000000000000FREE0/00000000-0000-4000-8000-00000000a001/photos/photo-1',
        thumbnailKey: null,
        contentType: 'image/jpeg',
        sizeBytes: 2048,
        sortOrder: 0,
        createdAt: BASE_DATE,
        updatedAt: BASE_DATE,
        ...overrides,
    };
}

/** Back-compat alias used by some suites — the version-row factory. */
export const makeVersion = makeVersionRow;
