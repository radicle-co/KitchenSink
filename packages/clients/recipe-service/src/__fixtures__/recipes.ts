/**
 * `make*` fixture factories for the `RecipeServiceClient` tests (CODING_STANDARDS `__fixtures__`).
 * Each accepts a `Partial<T>` of overrides and returns a fully-defined, JSON-safe value so a fixture can
 * be round-tripped through a fake fetch (`JSON.stringify` → `JSON.parse`) and still `toEqual` the input.
 * Optional domain fields are omitted (not set to `undefined`) so the serialized wire shape is exact.
 *
 * ── RESPONSE fixtures vs REQUEST fixtures ─────────────────────────────────────────────────────────
 *
 * Most factories here build RESPONSES, whose ids are deliberately loose on the wire
 * (`idSchema` = `z.string().min(1)`, because the document mixes app-user ULIDs with row UUIDs), so
 * readable `'rec_1'`/`'pho_1'` tokens are legal values there and stay.
 *
 * {@link makeCreateRecipeRequest} and the `FIXTURE_*_UUID` constants below build REQUESTS, which are held to
 * the published request schemas the client now validates its OUTBOUND bodies against
 * (`createRecipeRequestSchema`, `reorderPhotosRequestSchema`, `addRecipeToCollectionRequestSchema`,
 * `erasureRequestSchema`). Those schemas bound ids to real UUIDs and both recipe content arrays to
 * `.min(1)`, so a `'photo-1'`-style token or an empty `ingredients` array is a body the service answers
 * `400` to — never something a test should assert the client transmits.
 */
import type {
    Ingredient,
    PaginatedResponse,
    Recipe,
    RecipeDetail,
    RecipePhoto,
    RecipeSearchResult,
    RecipeVersion,
} from '@kitchensink/recipe-core';
import type { CreateRecipeRequest, RestoreVersionResponse } from '@kitchensink/schema-recipe';

import type {
    Collection,
    CollectionMemberRecipe,
    CollectionRecipeMembership,
    CollectionWithRecipes,
    ErasureRequestAcceptedResponse,
    PullDiff,
    PullFromSourceResponse,
    RecipeSearchResponse,
    UploadUrlResponse,
} from '../types.js';

// ── Request-side ids: UUIDs, because the published request schemas bound them to UUIDs ─────────────
//
// Every literal below is v4-shaped (version nibble `4`, variant nibble `8`) — the STRICTEST form any
// request field demands (`reorderPhotosRequestSchema.photoIds` is `z.uuid({ version: 'v4' })`), so one
// family of literals satisfies both it and the any-version `z.uuid()` fields. None is the nil UUID, which
// `photoIds` rejects outright because it names no row.

/**
 * The catalog `ingredients` row an ingredient line references.
 *
 * `recipeIngredientInputSchema.ingredientId` is `recipeIngredientIdSchema` — `z.uuid()`, matching the
 * `recipe_ingredients.ingredient_id uuid` column, and deliberately NOT the looser `idSchema`. An `'ing_1'`
 * token here is rejected before it reaches the wire.
 */
export const FIXTURE_INGREDIENT_UUID = '00000000-0000-4000-8000-00000000a001';

/** A `recipe_photos` row id — `reorderPhotosRequestSchema.photoIds` demands a **v4** UUID per entry. */
export const FIXTURE_PHOTO_UUID = '00000000-0000-4000-8000-00000000b001';

/** A second photo id, so a reorder fixture can express an actual change of order. */
export const FIXTURE_OTHER_PHOTO_UUID = '00000000-0000-4000-8000-00000000b002';

/**
 * A `recipes` row id as a REQUEST carries it — `addRecipeToCollectionRequestSchema.recipeId` and every
 * entry of `erasureRequestSchema.publishRecipeIds` are `z.uuid()`.
 */
export const FIXTURE_RECIPE_UUID = '00000000-0000-4000-8000-00000000c001';

/** A second recipe id, for bodies that carry more than one (the erasure donate election). */
export const FIXTURE_OTHER_RECIPE_UUID = '00000000-0000-4000-8000-00000000c002';

/**
 * Build the MINIMAL create-recipe body the service actually accepts.
 *
 * "Minimal" is bounded by `createRecipeRequestSchema`, not by what typechecks: `ingredients` and
 * `steps` are both `.min(1)` there (a recipe with neither is not a recipe, and the service answers `400`),
 * and `servings` plus all three timings are required. Every optional field is omitted so the serialized
 * body is exactly the required set.
 *
 * @param overrides - Fields to replace on the body.
 * @returns A complete, contract-valid create-recipe request. Pure.
 */
export function makeCreateRecipeRequest(overrides: Partial<CreateRecipeRequest> = {}): CreateRecipeRequest {
    return {
        title: 'Tomato Soup',
        // Non-empty on purpose: both arrays are `.min(1)` on the published request schema.
        ingredients: [{ ingredientId: FIXTURE_INGREDIENT_UUID, name: 'Tomato', quantity: 6 }],
        steps: [{ instruction: 'Simmer the tomatoes.' }],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        ...overrides,
    };
}

/** Build a light {@link Recipe} (list/search/collection projection — no cookable content). */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: 'rec_1',
        ownerId: 'usr_1',
        title: 'Tomato Soup',
        description: 'A warming bowl.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'private',
        status: 'published',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        dietaryFlags: ['vegan'],
        tags: ['soup'],
        currentVersion: 1,
        // CR-001 aggregate: an unrated recipe (ratingCount 0, no averageRating). Both are now REQUIRED on
        // the `Recipe` contract (FR-013a); a rating fixture overrides them.
        ratingCount: 0,
        // Derived PRO badge (FR-003a) — REQUIRED on `Recipe`. A private user_created recipe is premium,
        // but this default projection is the non-premium baseline; override per test.
        usesPremiumCapability: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a full {@link RecipeDetail} (a {@link Recipe} plus cookable content: ingredients/steps/photos). */
export function makeRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(),
        ingredients: [{ ingredientId: 'ing_1', name: 'Tomato', quantity: 6, isUserEntered: false }],
        steps: [{ stepNumber: 1, instruction: 'Simmer the tomatoes.' }],
        photos: [],
        nutrition: { calories: 120, proteinG: 4, carbsG: 20, fatG: 2, isComplete: true },
        ...overrides,
    };
}

/** Build an {@link Ingredient} (freeform or food-backed depending on overrides). */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        id: 'ing_1',
        name: 'Tomato',
        isUserEntered: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link Collection} (light projection — no member recipes). */
export function makeCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight dinners',
        visibility: 'private',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link CollectionMemberRecipe} (a {@link Recipe} plus its provenance within the collection). */
export function makeCollectionMemberRecipe(overrides: Partial<CollectionMemberRecipe> = {}): CollectionMemberRecipe {
    return {
        ...makeRecipe(),
        addedVia: 'manual',
        ...overrides,
    };
}

/** Build a {@link CollectionWithRecipes} (a collection plus its embedded member recipes). */
export function makeCollectionWithRecipes(overrides: Partial<CollectionWithRecipes> = {}): CollectionWithRecipes {
    return {
        ...makeCollection(),
        recipes: [makeCollectionMemberRecipe()],
        ...overrides,
    };
}

/** Build a {@link PullDiff} (added/removed/unchanged recipe id partitions). */
export function makePullDiff(overrides: Partial<PullDiff> = {}): PullDiff {
    return {
        added: ['rec_2'],
        removed: [],
        unchanged: ['rec_1'],
        ...overrides,
    };
}

/** Build a {@link RecipePhoto}. */
export function makeRecipePhoto(overrides: Partial<RecipePhoto> = {}): RecipePhoto {
    return {
        id: 'pho_1',
        recipeId: 'rec_1',
        key: 'recipes/rec_1/pho_1.jpg',
        url: 'https://cdn.example.test/recipes/rec_1/pho_1.jpg',
        contentType: 'image/jpeg',
        order: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link RecipeVersion} (snapshot carries empty step/ingredient arrays for a minimal fixture). */
export function makeRecipeVersion(overrides: Partial<RecipeVersion> = {}): RecipeVersion {
    return {
        id: 'ver_1',
        recipeId: 'rec_1',
        versionNumber: 1,
        snapshot: {
            version: 1,
            title: 'Tomato Soup',
            description: 'A warming bowl.',
            steps: [],
            ingredients: [],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
        },
        createdBy: 'usr_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link RestoreVersionResponse}. */
export function makeRestoreVersionResponse(overrides: Partial<RestoreVersionResponse> = {}): RestoreVersionResponse {
    return {
        recipe: makeRecipeDetail(),
        restoredFromVersion: 2,
        currentVersion: 5,
        ...overrides,
    };
}

/** Build an {@link UploadUrlResponse} (a presigned S3 upload URL). */
export function makeUploadUrlResponse(overrides: Partial<UploadUrlResponse> = {}): UploadUrlResponse {
    return {
        uploadUrl: 'https://s3.example.test/upload?sig=abc',
        key: 'recipes/rec_1/pending/pho_new.jpg',
        expiresIn: 900,
        maxBytes: 5_242_880,
        ...overrides,
    };
}

/** Build a {@link CollectionRecipeMembership} join record. */
export function makeCollectionRecipeMembership(
    overrides: Partial<CollectionRecipeMembership> = {},
): CollectionRecipeMembership {
    return {
        collectionId: 'col_1',
        recipeId: 'rec_1',
        addedVia: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link PullFromSourceResponse}. */
export function makePullFromSourceResponse(overrides: Partial<PullFromSourceResponse> = {}): PullFromSourceResponse {
    return {
        collection: makeCollection(),
        addedRecipeIds: ['rec_2', 'rec_3'],
        ...overrides,
    };
}

/** Build an {@link ErasureRequestAcceptedResponse}. */
export function makeErasureAccepted(
    overrides: Partial<ErasureRequestAcceptedResponse> = {},
): ErasureRequestAcceptedResponse {
    return {
        jobId: 'job_1',
        status: 'queued',
        ...overrides,
    };
}

/** Build a {@link RecipeSearchResult} (an object-per-hit envelope). */
export function makeRecipeSearchResult(overrides: Partial<RecipeSearchResult> = {}): RecipeSearchResult {
    return {
        recipe: makeRecipe(),
        rank: 0.87,
        ...overrides,
    };
}

/** Build a {@link RecipeSearchResponse} (ranked hits + facet counts). */
export function makeRecipeSearchResponse(overrides: Partial<RecipeSearchResponse> = {}): RecipeSearchResponse {
    return {
        results: [makeRecipeSearchResult()],
        total: 1,
        page: 1,
        pageSize: 20,
        hasMore: false,
        // All FOUR dimensions, because the contract requires them: the service always aggregates every
        // dimension over the match sample and sends `[]` for an empty one, never an absent key. This
        // fixture previously supplied only two, which typechecked while the client's own type declared
        // them optional -- the drift the generated contract now makes impossible.
        facets: {
            dietaryFlags: [{ value: 'vegan', count: 1 }],
            tags: [{ value: 'soup', count: 1 }],
            cuisine: [],
            totalTime: [],
        },
        ...overrides,
    };
}

/** Build a generic {@link PaginatedResponse} page around the given items. */
export function makePaginatedResponse<T>(
    data: readonly T[],
    overrides: Partial<Omit<PaginatedResponse<T>, 'data'>> = {},
): PaginatedResponse<T> {
    return {
        data: [...data],
        total: data.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        ...overrides,
    };
}
