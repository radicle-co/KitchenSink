/**
 * Schema barrel for `@kitchensink/recipe-service` (T015). Re-exports every Drizzle table + inferred row
 * type + controlled value set. This is the object passed to `drizzle(pool, { schema })` in `client.ts`.
 *
 * There is deliberately NO `users` table (D2): recipe `owner_id` / `created_by` / collection `owner_id`
 * store the app-user ULID directly (`VARCHAR(255) NOT NULL`, no FK, no user replication).
 */

// ── recipes + recipe_steps (T011) ─────────────────────────────────────────────────────────────────
export { tsvector, recipes, recipeSteps, RECIPE_VISIBILITIES, RECIPE_SOURCE_TYPES } from './recipes.js';
export type {
    RecipeRow,
    NewRecipeRow,
    RecipeStepRow,
    NewRecipeStepRow,
    RecipeVisibility,
    RecipeSourceType,
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
export { accountErasureJobs, ERASURE_JOB_STATUSES } from './account.js';
export type { AccountErasureJobRow, NewAccountErasureJobRow, ErasureJobStatus } from './account.js';

// ── convenience re-exports ────────────────────────────────────────────────────────────────────────
export type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
