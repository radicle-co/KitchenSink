/**
 * Typed `make*` fixture factories for the web recipe version-history container tests (T069). Each accepts
 * `Partial<T>` overrides over sensible defaults (constitution fixture convention). Kept local to the web
 * app's tests so they never depend on another package's (non-exported) fixtures.
 */
import type { RecipeSnapshot, RecipeVersion } from '@kitchensink/recipe-core';

/**
 * Build a {@link RecipeSnapshot} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default snapshot.
 * @returns A complete `RecipeSnapshot`.
 */
export function makeRecipeSnapshot(overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot {
    return {
        version: 1,
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        steps: [],
        ingredients: [],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        ...overrides,
    };
}

/**
 * Build a {@link RecipeVersion} with sensible defaults, overridable per field. Derives a unique `id` and a
 * matching snapshot `version` from `versionNumber` so distinct versions collide on neither.
 *
 * @param overrides - Fields to override on the default version.
 * @returns A complete `RecipeVersion`.
 */
export function makeRecipeVersion(overrides: Partial<RecipeVersion> = {}): RecipeVersion {
    const versionNumber = overrides.versionNumber ?? 1;

    return {
        id: `ver_${versionNumber}`,
        recipeId: 'rec_1',
        versionNumber,
        snapshot: makeRecipeSnapshot({ version: versionNumber }),
        createdBy: 'usr_1',
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}
