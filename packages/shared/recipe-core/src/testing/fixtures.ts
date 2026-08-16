/**
 * @module @kitchensink/recipe-core/testing — shared Object Mother fixtures for the pure-domain
 * wire-contract types (`Recipe`, `RecipeDetail`, `RecipeVersion`, `Collection`, `Ingredient`). Each
 * `make*` accepts `Partial<T>` overrides over sensible defaults (constitution fixture convention) and
 * RE-DERIVES any invariant field AFTER spreading overrides, so an override can never produce a
 * domain-illegal state.
 *
 * This is the ONE canonical implementation — web, mobile, and features previously carried byte-identical
 * (or worse, hand-hardcoded) copies. Deliberately excludes the client package's minimal-wire fixtures
 * (its tests assert exact wire round-trips — omitting optionals is the point) and the server's Drizzle
 * row-factories (a different layer entirely).
 */
import {
    FoodResolutionStatus,
    RecipeDifficulty,
    RecipeSourceType,
    RecipeStatus,
    RecipeVisibility,
    usesPremiumCapability,
    type Collection,
    type Ingredient,
    type Recipe,
    type RecipeDetail,
    type RecipeSnapshot,
    type RecipeVersion,
} from '../recipe.types.js';

/**
 * Build a full {@link Recipe} with sensible defaults, overridable per field.
 *
 * The default is a RATED, PRO recipe with a stated difficulty and a cover photo, so a consuming test
 * exercises every enriched field out of the box; overrides narrow to the other states (unrated, no
 * difficulty, free tier, no image). Two fields are DERIVED rather than stored as literals so the fixture
 * can never fabricate a state the domain forbids:
 *
 * - `usesPremiumCapability` is the materialized projection of the badge rule (recipe-core), so flipping
 *   `visibility`/`sourceType` yields the correct badge without restating it. An explicit override still
 *   wins.
 * - `averageRating` is present exactly when `ratingCount > 0` (the recipe-core invariant: an unrated
 *   recipe has NO average, never `0`), so `makeRecipe({ ratingCount: 0 })` drops the average instead of
 *   leaving a fake score behind.
 *
 * @param overrides - Fields to override on the default recipe.
 * @returns A complete `Recipe`.
 */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    const base = {
        id: 'rec_1',
        ownerId: 'usr_1',
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        difficulty: RecipeDifficulty.MEDIUM,
        visibility: RecipeVisibility.PRIVATE,
        status: RecipeStatus.PUBLISHED,
        sourceType: RecipeSourceType.USER_CREATED,
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        currentVersion: 1,
        averageRating: 4.5,
        ratingCount: 12,
        coverPhotoUrl: 'https://cdn.commise.app/recipes/rec_1/cover.jpg',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };

    return {
        ...base,
        // Keep the PRO flag and the average honest: the flag is the materialized badge rule, and an
        // average exists only alongside a non-zero count (recipe-core invariants). Explicit overrides win.
        usesPremiumCapability: overrides.usesPremiumCapability ?? usesPremiumCapability(base),
        averageRating: base.ratingCount > 0 ? base.averageRating : undefined,
    };
}

/**
 * Build a full {@link RecipeDetail} (a {@link Recipe} plus ingredients, steps, photos, nutrition) with
 * sensible defaults, overridable per field. Inherits {@link makeRecipe}'s invariant-safe defaults.
 *
 * @param overrides - Fields to override on the default recipe detail.
 * @returns A complete `RecipeDetail`.
 */
export function makeRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(),
        ingredients: [
            {
                // A v4 UUID, because `recipe_ingredients.ingredient_id` IS a `uuid` column and the recipe
                // service's create/update contract enforces that. A short token like `ing_1` describes a
                // state the database cannot hold, so a draft built from it looked submittable here while the
                // API would answer 400 — which is exactly what the editor's validator now catches.
                ingredientId: '00000000-0000-4000-8000-000000000001',
                name: 'Olive oil',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
            },
        ],
        steps: [{ stepNumber: 1, instruction: 'Combine the ingredients.' }],
        photos: [],
        nutrition: { calories: 520, proteinG: 32, carbsG: 18, fatG: 34, isComplete: true },
        ...overrides,
    };
}

/**
 * Build a {@link RecipeSnapshot} with sensible defaults, overridable per field. Internal support for
 * {@link makeRecipeVersion} only — deliberately NOT exported, since the shared surface is scoped to the
 * five pure-domain wire-contract fixtures (`makeRecipe`, `makeRecipeDetail`, `makeRecipeVersion`,
 * `makeCollection`, `makeIngredient`).
 *
 * @param overrides - Fields to override on the default snapshot.
 * @returns A complete `RecipeSnapshot`.
 */
function makeRecipeSnapshot(overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot {
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
 * matching snapshot `version` from `versionNumber` so distinct versions collide on neither — an override
 * of `versionNumber` alone still produces an internally-consistent version/snapshot pair.
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

/**
 * Build a complete {@link Collection} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default collection.
 * @returns A complete `Collection`.
 */
export function makeCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight dinners',
        visibility: 'private',
        description: 'Fast, comforting meals for busy nights.',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

/**
 * Build a complete catalog {@link Ingredient} with sensible defaults (a resolved, food-backed item),
 * overridable per field.
 *
 * @param overrides - Fields to override on the default ingredient.
 * @returns A complete `Ingredient`.
 */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        // A v4 UUID — `ingredients.id` is a `uuid` column; see `makeRecipeDetail` above.
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Olive oil',
        foodId: 'food_1',
        foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        isUserEntered: false,
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}
