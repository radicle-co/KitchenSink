/**
 * T082 — backend fixture factories for the recipe service's unit + integration tests.
 *
 * `make*` factories accept a `Partial<T>` of overrides and return a fully-populated value, so a test
 * only states the fields it cares about (per CODING_STANDARDS fixture-factory convention). Two shapes
 * are provided: the persistence rows (`makeRecipeRow` / `makeVersionRow` — what the DAL returns) and
 * the shared domain `Recipe` (`makeRecipe` — the wire/domain contract from `@kitchensink/recipe-core`).
 */
import type { Recipe } from '@kitchensink/recipe-core';

import type { RecipeRow, RecipeStepRow, RecipeVersionRow } from '../database/schema/index.js';

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
        visibility: 'public',
        sourceType: 'user_created',
        sourceUrl: null,
        sourceAttribution: null,
        clonedFromId: null,
        hasSubstantiveEdit: false,
        cuisine: 'italian',
        dietaryFlags: [],
        tags: ['dinner'],
        hasPartialNutrition: false,
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
        description: 'A recipe used in tests.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'public',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        cuisine: 'italian',
        dietaryFlags: [],
        tags: ['dinner'],
        hasPartialNutrition: false,
        currentVersion: 1,
        createdAt: BASE_DATE.toISOString(),
        updatedAt: BASE_DATE.toISOString(),
        ...overrides,
    };
}

/** Back-compat alias used by some suites — the version-row factory. */
export const makeVersion = makeVersionRow;
