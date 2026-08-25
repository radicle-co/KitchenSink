/**
 * Schema barrel for `@kitchensink/recipe-service` (T015). Re-exports every Drizzle table + inferred row
 * type + controlled value set. This is the object passed to `drizzle(pool, { schema })` in `client.ts`.
 *
 * There is deliberately NO `users` table (D2): recipe `owner_id` / `created_by` / collection `owner_id`
 * store the app-user ULID directly (`VARCHAR(255) NOT NULL`, no FK, no user replication).
 */

// ── recipes + recipe_steps (T011) ─────────────────────────────────────────────────────────────────
export {
    tsvector,
    recipes,
    recipeSteps,
    RECIPE_VISIBILITIES,
    RECIPE_SOURCE_TYPES,
    RECIPE_DIFFICULTIES,
    RECIPE_STATUSES,
} from './recipes.js';
export type {
    RecipeRow,
    NewRecipeRow,
    RecipeStepRow,
    NewRecipeStepRow,
    RecipeVisibility,
    RecipeSourceType,
    RecipeDifficulty,
    RecipeStatus,
} from './recipes.js';

// ── ingredients + recipe_ingredients (T012) ───────────────────────────────────────────────────────
export { ingredients, recipeIngredients, FOOD_RESOLUTION_STATUSES } from './ingredients.js';
export type {
    IngredientRow,
    NewIngredientRow,
    RecipeIngredientRow,
    NewRecipeIngredientRow,
    FoodResolutionStatus,
} from './ingredients.js';

// ── ingredient_resolution_mappings + ingredient_resolution_memos (plan U10, 0021) ───────────────
export {
    ingredientResolutionMappings,
    ingredientResolutionMemos,
    RESOLUTION_MAPPING_SCOPES,
    RESOLUTION_MAPPING_ORIGINS,
} from './resolutionMappings.js';
export type {
    IngredientResolutionMappingRow,
    NewIngredientResolutionMappingRow,
    IngredientResolutionMemoRow,
    NewIngredientResolutionMemoRow,
} from './resolutionMappings.js';

// ── ingredient_parse_corrections (plan U21, 0029) — the parse pipeline's TOP tier ─────────────────
export {
    ingredientParseCorrections,
    PARSE_CORRECTION_SCOPES,
    PARSE_CORRECTION_ORIGINS,
} from './ingredientParseCorrections.js';
export type {
    CorrectedParse,
    IngredientParseCorrectionRow,
    JsonValue,
    NewIngredientParseCorrectionRow,
} from './ingredientParseCorrections.js';

// ── recipe_ingredient_verifications (plan U11/U14, 0023) — READ-ONLY here; recipe-workers writes it ──
export { recipeIngredientVerifications, LINE_VERIFICATION_BANDS } from './lineVerifications.js';
export type { RecipeIngredientVerificationRow } from './lineVerifications.js';

// ── ingredient_parse_cache (plan U20 / KTD-13, KTD-14, 0028) — engine parses, keyed by digest+engine ──
export { ingredientParseCache, PARSE_CACHE_ENGINES } from './ingredientParseCache.js';
export type { IngredientParseCacheRow, CachedParsePayload } from './ingredientParseCache.js';

// ── recipe_versions + recipe_version_pending_archives (T013, T121) ────────────────────────────────
export { recipeVersions, recipeVersionPendingArchives, PENDING_ARCHIVE_STATUSES } from './versions.js';
export type {
    RecipeVersionRow,
    NewRecipeVersionRow,
    RecipeVersionPendingArchiveRow,
    NewRecipeVersionPendingArchiveRow,
    PendingArchiveStatus,
} from './versions.js';

// ── recipe_photos (T013) ──────────────────────────────────────────────────────────────────────────
export { recipePhotos } from './photos.js';
export type { RecipePhotoRow, NewRecipePhotoRow } from './photos.js';

// ── recipe_ratings (CR-001 / FR-013) ──────────────────────────────────────────────────────────────
export { recipeRatings } from './ratings.js';
export type { RecipeRatingRow, NewRecipeRatingRow } from './ratings.js';

export { authorHandles } from './authorHandles.js';
export type { AuthorHandleRow, AuthorHandleInsert } from './authorHandles.js';

// ── collections + recipe_collections (T014, T119) ─────────────────────────────────────────────────
export { collections, recipeCollections, COLLECTION_VISIBILITIES, RECIPE_COLLECTION_ADDED_VIA } from './collections.js';
export type {
    CollectionRow,
    NewCollectionRow,
    RecipeCollectionRow,
    NewRecipeCollectionRow,
    CollectionVisibility,
    RecipeCollectionAddedVia,
} from './collections.js';

// ── account_erasure_jobs (T122) ───────────────────────────────────────────────────────────────────
export { accountErasureJobs, ERASURE_JOB_STATUSES, ACTIVE_ERASURE_JOB_STATUSES } from './account.js';
export type {
    AccountErasureJobRow,
    NewAccountErasureJobRow,
    ErasureJobStatus,
    ActiveErasureJobStatus,
} from './account.js';

// ── convenience re-exports ────────────────────────────────────────────────────────────────────────
export type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
