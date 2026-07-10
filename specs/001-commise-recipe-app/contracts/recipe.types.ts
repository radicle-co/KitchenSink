/** @module @kitchensink/recipe-core — Shared types and Zod schemas for Commise recipe management */

// @ts-expect-error -- Design artifact imports zod as a package dependency of @kitchensink/recipe-core.
import { z } from 'zod';

const idSchema = z.string().min(1);
const isoDateTimeStringSchema = z.string().datetime({ offset: true });
const nonNegativeNumberSchema = z.number().finite().nonnegative();
// Strictly-positive quantity validator: the `recipe_ingredients` DB CHECK is `quantity > 0`,
// so 0 must be rejected (a zero-quantity ingredient line is meaningless).
const positiveNumberSchema = z.number().finite().positive();
const positiveIntSchema = z.number().int().positive();
const nonNegativeIntSchema = z.number().int().nonnegative();

/**
 * ISO 8601 date-time string with timezone offset (for example, `2026-04-18T12:34:56.000Z`).
 */
export type IsoDateTimeString = string;

/**
 * Runtime validator for {@link IsoDateTimeString} values.
 */
export const isoDateTimeSchema = isoDateTimeStringSchema;

/**
 * Allowed recipe visibility values.
 */
export const RecipeVisibility = {
    PUBLIC: 'public',
    PRIVATE: 'private',
} as const;

/**
 * Visibility state for a recipe.
 */
export type RecipeVisibility = (typeof RecipeVisibility)[keyof typeof RecipeVisibility];

/**
 * Runtime validator for {@link RecipeVisibility}.
 */
export const recipeVisibilitySchema = z.enum([RecipeVisibility.PUBLIC, RecipeVisibility.PRIVATE]);

/**
 * Allowed recipe source types.
 */
export const RecipeSourceType = {
    USER_CREATED: 'user_created',
    IMPORTED_PUBLIC: 'imported_public',
    IMPORTED_PHYSICAL: 'imported_physical',
    IMPORTED_PAID: 'imported_paid',
} as const;

/**
 * Source classification for recipe provenance.
 */
export type RecipeSourceType = (typeof RecipeSourceType)[keyof typeof RecipeSourceType];

/**
 * Runtime validator for {@link RecipeSourceType}.
 */
export const recipeSourceTypeSchema = z.enum([
    RecipeSourceType.USER_CREATED,
    RecipeSourceType.IMPORTED_PUBLIC,
    RecipeSourceType.IMPORTED_PHYSICAL,
    RecipeSourceType.IMPORTED_PAID,
]);

/**
 * Sort options supported by recipe search.
 */
export const RecipeSearchSortBy = {
    RELEVANCE: 'relevance',
    RECENT: 'recent',
    TITLE: 'title',
} as const;

/**
 * Sort key for recipe search requests.
 */
export type RecipeSearchSortBy = (typeof RecipeSearchSortBy)[keyof typeof RecipeSearchSortBy];

/**
 * Runtime validator for {@link RecipeSearchSortBy}.
 */
export const recipeSearchSortBySchema = z.enum([
    RecipeSearchSortBy.RELEVANCE,
    RecipeSearchSortBy.RECENT,
    RecipeSearchSortBy.TITLE,
]);

/**
 * Recipe-level metadata and ownership record.
 */
export interface Recipe {
    id: string;
    ownerId: string;
    title: string;
    description: string;
    prepTimeMinutes: number;
    cookTimeMinutes: number;
    totalTimeMinutes: number;
    servings: number;
    visibility: RecipeVisibility;
    sourceType: RecipeSourceType;
    sourceUrl?: string;
    sourceAttribution?: string;
    clonedFromId?: string;
    hasSubstantiveEdit: boolean;
    cuisine?: string;
    dietaryFlags: string[];
    tags: string[];
    hasPartialNutrition: boolean;
    currentVersion: number;
    /**
     * Soft-delete tombstone (C-007). When set, the recipe is excluded from every
     * production read path. Hard removal happens only via the user-initiated
     * GDPR erasure flow.
     */
    deletedAt?: IsoDateTimeString;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link Recipe}.
 */
export const recipeSchema = z.object({
    id: idSchema,
    ownerId: idSchema,
    title: z.string().min(1),
    description: z.string().default(''),
    prepTimeMinutes: nonNegativeIntSchema,
    cookTimeMinutes: nonNegativeIntSchema,
    totalTimeMinutes: nonNegativeIntSchema,
    servings: positiveIntSchema,
    visibility: recipeVisibilitySchema,
    sourceType: recipeSourceTypeSchema,
    sourceUrl: z.string().url().optional(),
    sourceAttribution: z.string().min(1).optional(),
    clonedFromId: idSchema.optional(),
    hasSubstantiveEdit: z.boolean(),
    cuisine: z.string().min(1).optional(),
    dietaryFlags: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
    hasPartialNutrition: z.boolean(),
    currentVersion: positiveIntSchema,
    deletedAt: isoDateTimeStringSchema.optional(),
    createdAt: isoDateTimeStringSchema,
    updatedAt: isoDateTimeStringSchema,
});

/**
 * A numbered instruction line within a recipe. `stepNumber` is server-assigned
 * (1-based ordering); `timerSeconds` is an optional inline timer for the step.
 */
export interface RecipeStep {
    id: string;
    recipeId: string;
    stepNumber: number;
    instruction: string;
    timerSeconds?: number;
}

/**
 * Runtime validator for {@link RecipeStep}.
 */
export const recipeStepSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    stepNumber: positiveIntSchema,
    instruction: z.string().min(1),
    timerSeconds: nonNegativeIntSchema.optional(),
});

/**
 * Async resolution state of an ingredient's backing food record in the
 * source-agnostic food service (003). Values mirror the shipped food client's
 * `FoodStatus` (`@kitchensink/food-service-client`), including the terminal
 * `NOT_FOUND` / `FAILED` states. A just-added food may report `PENDING` or
 * `UNRESOLVED` (nutrition not ready yet, or awaiting disambiguation) and
 * transition to `RESOLVED` later; consumers must tolerate partial nutrition in
 * the interim (FR-007). `NOT_FOUND` / `FAILED` are terminal — the picker UX
 * surfaces an error, offers a freeform fallback, and allows removal. Whether an
 * ingredient is freeform is a SEPARATE concern tracked by
 * {@link Ingredient.isUserEntered}, never a resolution-status value.
 */
export const FoodResolutionStatus = {
    PENDING: 'PENDING',
    UNRESOLVED: 'UNRESOLVED',
    RESOLVED: 'RESOLVED',
    NOT_FOUND: 'NOT_FOUND',
    FAILED: 'FAILED',
} as const;

/**
 * Resolution lifecycle status for an ingredient's {@link Ingredient.foodId}.
 */
export type FoodResolutionStatus = (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus];

/**
 * Runtime validator for {@link FoodResolutionStatus}.
 */
export const foodResolutionStatusSchema = z.enum([
    FoodResolutionStatus.PENDING,
    FoodResolutionStatus.UNRESOLVED,
    FoodResolutionStatus.RESOLVED,
    FoodResolutionStatus.NOT_FOUND,
    FoodResolutionStatus.FAILED,
]);

/**
 * Canonical ingredient definition, optionally enriched with nutrition per 100g.
 *
 * Nutrition is backed by the source-agnostic food service (003) via its typed
 * client (`@kitchensink/food-service-client`); foods are referenced by the food
 * service's internal id ({@link foodId}), and resolution is asynchronous. The
 * food↔ingredient link is owned by 001.
 */
export interface Ingredient {
    id: string;
    name: string;
    /**
     * Opaque reference to the food service's internal id (ULID) for the golden
     * food record backing this ingredient. Never a source-specific external
     * identifier, and never a cross-DB foreign key — the food service (003) is
     * source-agnostic and owns its own store; 001 holds only this opaque
     * reference.
     */
    foodId?: string;
    /**
     * Async resolution state of {@link foodId} in the food service. Present only
     * for database-backed ingredients (a {@link foodId} is set); absent for
     * user-entered ingredients that carry no food reference.
     */
    foodResolutionStatus?: FoodResolutionStatus;
    isUserEntered: boolean;
    caloriesPer100g?: number;
    proteinGPer100g?: number;
    carbsGPer100g?: number;
    fatGPer100g?: number;
    createdAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link Ingredient}.
 */
export const ingredientSchema = z.object({
    id: idSchema,
    name: z.string().min(1),
    foodId: idSchema.optional(),
    foodResolutionStatus: foodResolutionStatusSchema.optional(),
    isUserEntered: z.boolean(),
    caloriesPer100g: nonNegativeNumberSchema.optional(),
    proteinGPer100g: nonNegativeNumberSchema.optional(),
    carbsGPer100g: nonNegativeNumberSchema.optional(),
    fatGPer100g: nonNegativeNumberSchema.optional(),
    createdAt: isoDateTimeStringSchema,
});

/**
 * Ingredient line item linked to a recipe, including optional user-provided nutrition.
 *
 * These are the canonical DOMAIN field names. The REST wire schema
 * (`RecipeIngredient` in `api.openapi.yaml`) exposes a subset under shorter
 * names — the mapping is: domain `ingredientName` ↔ wire `name`, domain
 * `displayText` ↔ wire `notes`. `quantity`/`unit`/`ingredientId` are shared.
 */
export interface RecipeIngredient {
    id: string;
    recipeId: string;
    ingredientId: string;
    quantity: number;
    unit: string;
    /** Free-form display override (wire field: `notes`). */
    displayText?: string;
    sortOrder: number;
    /** Canonical ingredient label (wire field: `name`). */
    ingredientName: string;
    isUserEntered: boolean;
    userCalories?: number;
    userProteinG?: number;
    userCarbsG?: number;
    userFatG?: number;
}

/**
 * Runtime validator for {@link RecipeIngredient}.
 */
export const recipeIngredientSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    ingredientId: idSchema,
    quantity: positiveNumberSchema,
    unit: z.string().min(1),
    displayText: z.string().min(1).optional(),
    sortOrder: nonNegativeIntSchema,
    ingredientName: z.string().min(1),
    isUserEntered: z.boolean(),
    userCalories: nonNegativeNumberSchema.optional(),
    userProteinG: nonNegativeNumberSchema.optional(),
    userCarbsG: nonNegativeNumberSchema.optional(),
    userFatG: nonNegativeNumberSchema.optional(),
});

/**
 * Image asset metadata for a recipe photo. A single stored object served as-is via the CDN — no variants,
 * no processing lifecycle. The server resolves the full CDN `url`; `order` is the 1-based display position.
 */
export interface RecipePhoto {
    id: string;
    recipeId: string;
    key: string;
    url: string;
    contentType: string;
    order: number;
    createdAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link RecipePhoto}.
 */
export const recipePhotoSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    key: z.string().min(1),
    url: z.string().url(),
    contentType: z.string().min(1),
    order: positiveIntSchema,
    createdAt: isoDateTimeStringSchema,
});

/**
 * Immutable content snapshot stored for each recipe version.
 */
export interface RecipeSnapshot {
    version: number;
    title: string;
    description: string;
    steps: RecipeStep[];
    ingredients: RecipeIngredient[];
    servings: number;
    prepTimeMinutes: number;
    cookTimeMinutes: number;
}

/**
 * Runtime validator for {@link RecipeSnapshot}.
 */
export const recipeSnapshotSchema: z.ZodType<RecipeSnapshot> = z.object({
    version: positiveIntSchema,
    title: z.string().min(1),
    description: z.string().default(''),
    steps: z.array(recipeStepSchema),
    ingredients: z.array(recipeIngredientSchema),
    servings: positiveIntSchema,
    prepTimeMinutes: nonNegativeIntSchema,
    cookTimeMinutes: nonNegativeIntSchema,
});

/**
 * Version history record for a recipe, including snapshot storage metadata.
 */
export interface RecipeVersion {
    id: string;
    recipeId: string;
    versionNumber: number;
    snapshot: RecipeSnapshot;
    baseVersion?: number;
    s3Key?: string;
    createdBy: string;
    changeSummary?: string;
    createdAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link RecipeVersion}.
 */
export const recipeVersionSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    versionNumber: positiveIntSchema,
    snapshot: recipeSnapshotSchema,
    baseVersion: positiveIntSchema.optional(),
    s3Key: z.string().min(1).optional(),
    createdBy: idSchema,
    changeSummary: z.string().min(1).optional(),
    createdAt: isoDateTimeStringSchema,
});

/**
 * User-owned collection used to organize recipes.
 */
export interface Collection {
    id: string;
    ownerId: string;
    name: string;
    description?: string;
    /**
     * Set when this collection was cloned from another collection (FR-011).
     * Pull-from-source updates are explicit and opt-in; this field never causes
     * implicit re-sync of recipe membership.
     */
    sourceCollectionId?: string;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link Collection}.
 */
export const collectionSchema = z.object({
    id: idSchema,
    ownerId: idSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    sourceCollectionId: idSchema.optional(),
    createdAt: isoDateTimeStringSchema,
    updatedAt: isoDateTimeStringSchema,
});

/**
 * Provenance of how a recipe entered a collection (FR-011).
 */
export const RecipeCollectionAddedVia = {
    MANUAL: 'manual',
    CLONE_SEED: 'clone_seed',
    PULL: 'pull',
} as const;

export type RecipeCollectionAddedVia = (typeof RecipeCollectionAddedVia)[keyof typeof RecipeCollectionAddedVia];

export const recipeCollectionAddedViaSchema = z.enum([
    RecipeCollectionAddedVia.MANUAL,
    RecipeCollectionAddedVia.CLONE_SEED,
    RecipeCollectionAddedVia.PULL,
]);

/**
 * Join record linking a recipe to a collection.
 */
export interface RecipeCollection {
    collectionId: string;
    recipeId: string;
    addedAt: IsoDateTimeString;
    addedVia: RecipeCollectionAddedVia;
}

/**
 * Runtime validator for {@link RecipeCollection}.
 */
export const recipeCollectionSchema = z.object({
    collectionId: idSchema,
    recipeId: idSchema,
    addedAt: isoDateTimeStringSchema,
    addedVia: recipeCollectionAddedViaSchema,
});

/**
 * Lifecycle status of a pending S3 archive for a recipe version (FR-007b-i).
 */
export const RecipeVersionArchiveStatus = {
    PENDING: 'pending',
    IN_FLIGHT: 'in_flight',
    FAILED: 'failed',
    DLQ: 'dlq',
} as const;

export type RecipeVersionArchiveStatus = (typeof RecipeVersionArchiveStatus)[keyof typeof RecipeVersionArchiveStatus];

export const recipeVersionArchiveStatusSchema = z.enum([
    RecipeVersionArchiveStatus.PENDING,
    RecipeVersionArchiveStatus.IN_FLIGHT,
    RecipeVersionArchiveStatus.FAILED,
    RecipeVersionArchiveStatus.DLQ,
]);

/**
 * Tracks a recipe-version snapshot that has been written to PostgreSQL but not
 * yet archived to S3. The recipe save transaction is the source of truth; S3
 * archiving is asynchronous and retried via SQS until success (FR-007b-i).
 */
export interface RecipeVersionPendingArchive {
    id: string;
    recipeVersionId: string;
    recipeId: string;
    versionNumber: number;
    status: RecipeVersionArchiveStatus;
    attempts: number;
    lastError?: string;
    nextAttemptAt: IsoDateTimeString;
    sqsMessageId?: string;
    sqsReceipt?: string;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link RecipeVersionPendingArchive}.
 */
export const recipeVersionPendingArchiveSchema = z.object({
    id: idSchema,
    recipeVersionId: idSchema,
    recipeId: idSchema,
    versionNumber: positiveIntSchema,
    status: recipeVersionArchiveStatusSchema,
    attempts: nonNegativeIntSchema,
    lastError: z.string().min(1).optional(),
    nextAttemptAt: isoDateTimeStringSchema,
    sqsMessageId: z.string().min(1).optional(),
    sqsReceipt: z.string().min(1).optional(),
    createdAt: isoDateTimeStringSchema,
    updatedAt: isoDateTimeStringSchema,
});

/**
 * Input payload for a single ingredient when creating or updating a recipe draft.
 */
export interface CreateRecipeIngredientInput {
    ingredientId?: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    displayText?: string;
    userCalories?: number;
    userProteinG?: number;
    userCarbsG?: number;
    userFatG?: number;
}

/**
 * Runtime validator for {@link CreateRecipeIngredientInput}.
 */
export const createRecipeIngredientInputSchema = z.object({
    ingredientId: idSchema.optional(),
    ingredientName: z.string().min(1),
    quantity: positiveNumberSchema,
    unit: z.string().min(1),
    displayText: z.string().min(1).optional(),
    userCalories: nonNegativeNumberSchema.optional(),
    userProteinG: nonNegativeNumberSchema.optional(),
    userCarbsG: nonNegativeNumberSchema.optional(),
    userFatG: nonNegativeNumberSchema.optional(),
});

/**
 * Input payload for a single instruction step when creating or updating a recipe
 * draft. The server assigns `stepNumber` from array order; the client sends only
 * the instruction text and an optional inline timer.
 */
export interface CreateRecipeStepInput {
    instruction: string;
    timerSeconds?: number;
}

/**
 * Runtime validator for {@link CreateRecipeStepInput}.
 */
export const createRecipeStepInputSchema = z.object({
    instruction: z.string().min(1),
    timerSeconds: nonNegativeIntSchema.optional(),
});

/**
 * Input payload to create a new recipe.
 */
export interface CreateRecipeInput {
    title: string;
    description?: string;
    ingredients: CreateRecipeIngredientInput[];
    steps: CreateRecipeStepInput[];
    servings: number;
    prepTimeMinutes: number;
    cookTimeMinutes: number;
    totalTimeMinutes: number;
    cuisine?: string;
    dietaryFlags?: string[];
    tags?: string[];
    visibility?: RecipeVisibility;
}

/**
 * Runtime validator for {@link CreateRecipeInput}.
 */
export const createRecipeInputSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    ingredients: z.array(createRecipeIngredientInputSchema),
    steps: z.array(createRecipeStepInputSchema),
    servings: positiveIntSchema,
    prepTimeMinutes: nonNegativeIntSchema,
    cookTimeMinutes: nonNegativeIntSchema,
    totalTimeMinutes: nonNegativeIntSchema,
    cuisine: z.string().min(1).optional(),
    dietaryFlags: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    visibility: recipeVisibilitySchema.optional(),
});

/**
 * Input payload to update an existing recipe with optimistic concurrency protection.
 */
export interface UpdateRecipeInput extends Partial<CreateRecipeInput> {
    expectedVersion: number;
}

/**
 * Runtime validator for {@link UpdateRecipeInput}.
 */
export const updateRecipeInputSchema = createRecipeInputSchema.partial().extend({
    expectedVersion: positiveIntSchema,
});

/**
 * Query parameters for recipe catalog search.
 */
export interface RecipeSearchParams {
    query?: string;
    cuisine?: string;
    dietaryFlags?: string[];
    tags?: string[];
    maxPrepTime?: number;
    maxTotalTime?: number;
    ingredientIds?: string[];
    page?: number;
    pageSize?: number;
    sortBy?: RecipeSearchSortBy;
}

/**
 * Runtime validator for {@link RecipeSearchParams}.
 */
export const recipeSearchParamsSchema = z.object({
    query: z.string().min(1).optional(),
    cuisine: z.string().min(1).optional(),
    dietaryFlags: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    maxPrepTime: nonNegativeIntSchema.optional(),
    maxTotalTime: nonNegativeIntSchema.optional(),
    ingredientIds: z.array(idSchema).optional(),
    page: positiveIntSchema.optional(),
    pageSize: positiveIntSchema.optional(),
    sortBy: recipeSearchSortBySchema.optional(),
});

/**
 * Single ranked hit in a recipe search response. An object-per-hit envelope (not a bare `Recipe`) so
 * future per-result metadata is an ADDITIVE field, never a breaking reshape.
 */
export interface RecipeSearchResult {
    recipe: Recipe;
    rank?: number;
}

/**
 * Runtime validator for {@link RecipeSearchResult}.
 */
export const recipeSearchResultSchema = z.object({
    recipe: recipeSchema,
    rank: z.number().finite().optional(),
});

/**
 * Generic paginated API envelope shared by web, mobile, and API consumers.
 */
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

/**
 * Factory for runtime validators of {@link PaginatedResponse} payloads.
 */
export const paginatedResponseSchema = <T extends z.ZodType<unknown>>(itemSchema: T) =>
    z.object({
        data: z.array(itemSchema),
        total: nonNegativeIntSchema,
        page: positiveIntSchema,
        pageSize: positiveIntSchema,
        hasMore: z.boolean(),
    });

/**
 * Allowed recipe-domain error codes.
 */
export const RecipeErrorCode = {
    RECIPE_NOT_FOUND: 'RECIPE_NOT_FOUND',
    RECIPE_TOMBSTONED: 'RECIPE_TOMBSTONED',
    NOT_OWNER: 'NOT_OWNER',
    VERSION_CONFLICT: 'VERSION_CONFLICT',
    MAX_PHOTOS_EXCEEDED: 'MAX_PHOTOS_EXCEEDED',
    INVALID_VISIBILITY: 'INVALID_VISIBILITY',
    PHOTO_PROCESSING_FAILED: 'PHOTO_PROCESSING_FAILED',
    ARCHIVE_PENDING: 'ARCHIVE_PENDING',
    ARCHIVE_DLQ: 'ARCHIVE_DLQ',
    COLLECTION_NOT_CLONED: 'COLLECTION_NOT_CLONED',
    ERASURE_IN_PROGRESS: 'ERASURE_IN_PROGRESS',
} as const;

/**
 * Error code emitted by recipe-domain operations.
 */
export type RecipeErrorCode = (typeof RecipeErrorCode)[keyof typeof RecipeErrorCode];

/**
 * Runtime validator for {@link RecipeErrorCode}.
 */
export const recipeErrorCodeSchema = z.enum([
    RecipeErrorCode.RECIPE_NOT_FOUND,
    RecipeErrorCode.RECIPE_TOMBSTONED,
    RecipeErrorCode.NOT_OWNER,
    RecipeErrorCode.VERSION_CONFLICT,
    RecipeErrorCode.MAX_PHOTOS_EXCEEDED,
    RecipeErrorCode.INVALID_VISIBILITY,
    RecipeErrorCode.PHOTO_PROCESSING_FAILED,
    RecipeErrorCode.ARCHIVE_PENDING,
    RecipeErrorCode.ARCHIVE_DLQ,
    RecipeErrorCode.COLLECTION_NOT_CLONED,
    RecipeErrorCode.ERASURE_IN_PROGRESS,
]);

/**
 * Structured domain error contract for recipe operations.
 */
export interface RecipeError {
    code: RecipeErrorCode;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Runtime validator for {@link RecipeError}.
 */
export const recipeErrorSchema = z.object({
    code: recipeErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
});
