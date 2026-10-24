/**
 * @module @commise/features-recipes/versions/__fixtures__ — `makeRecipeVersion` is the shared,
 * invariant-deriving Object Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported here so the
 * version surface's tests (T069/T070) keep importing from this local module. `makeVersionConflictSide`
 * (W7) is local: it builds the 409's `server`/`base` side shape (`VersionConflictSide`), which has no
 * upstream Object Mother of its own.
 */
import { makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import type { RecipeIngredient, RecipeSnapshot, VersionConflictSide } from '@kitchensink/recipe-core';

export { makeRecipeVersion };

/**
 * A default {@link RecipeIngredient} snapshot line, overridable per field.
 *
 * ⚠️ Lives here rather than in one suite because `model.test.ts` — which declared it — was split into one
 * suite per version module, and six copies of a fixture is the drift DRY governs.
 *
 * @param overrides - Fields to override on the default line.
 * @returns A complete `RecipeIngredient`.
 */
export const makeIngredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
    id: 'ri_1',
    recipeId: 'rec_1',
    ingredientId: 'ing_1',
    quantity: { kind: 'exact', value: 200 },
    unit: 'g',
    sortOrder: 1,
    ingredientName: 'Pasta',
    isUserEntered: false,
    ...overrides,
});

/**
 * A default {@link RecipeSnapshot}, overridable per field — mirrors the default `makeRecipeVersion` shape.
 *
 * @param overrides - Fields to override on the default snapshot.
 * @returns A complete `RecipeSnapshot`.
 */
export const makeSnapshot = (overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot => ({
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast, comforting weeknight dinner.',
    steps: [],
    ingredients: [],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ...overrides,
});

/**
 * Build a {@link VersionConflictSide} (a 409's `server`/`base` side, W8-a.5) with sensible defaults,
 * overridable per field.
 *
 * @param overrides - Fields to override on the default side.
 * @returns A complete `VersionConflictSide`.
 */
export function makeVersionConflictSide(overrides: Partial<VersionConflictSide> = {}): VersionConflictSide {
    const versionNumber = overrides.versionNumber ?? 6;

    return {
        versionNumber,
        updatedAt: '2026-05-09T14:30:00.000Z',
        snapshot: makeRecipeVersion({ versionNumber }).snapshot,
        ...overrides,
    };
}
