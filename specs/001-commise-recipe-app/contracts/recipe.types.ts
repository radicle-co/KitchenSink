/** @module @kitchensink/recipe-core — Shared types and Zod schemas for Commise recipe management */

// @ts-expect-error -- Design artifact imports zod as a package dependency of @kitchensink/recipe-core.
import { z } from 'zod';

const idSchema = z.string().min(1);
const isoDateTimeStringSchema = z.string().datetime({ offset: true });
const nonNegativeNumberSchema = z.number().finite().nonnegative();
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
 * Allowed photo processing status values.
 */
export const PhotoProcessingStatus = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETE: 'complete',
    FAILED: 'failed',
} as const;

/**
 * Processing lifecycle status for a recipe photo.
 */
export type PhotoProcessingStatus = (typeof PhotoProcessingStatus)[keyof typeof PhotoProcessingStatus];

/**
 * Runtime validator for {@link PhotoProcessingStatus}.
 */
export const photoProcessingStatusSchema = z.enum([
    PhotoProcessingStatus.PENDING,
    PhotoProcessingStatus.PROCESSING,
    PhotoProcessingStatus.COMPLETE,
    PhotoProcessingStatus.FAILED,
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
 * A numbered instruction line within a recipe.
 */
export interface RecipeStep {
    id: string;
    recipeId: string;
    stepNumber: number;
    instruction: string;
}

/**
 * Runtime validator for {@link RecipeStep}.
 */
export const recipeStepSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    stepNumber: positiveIntSchema,
    instruction: z.string().min(1),
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
 */
export interface RecipeIngredient {
    id: string;
    recipeId: string;
    ingredientId: string;
    quantity: number;
    unit: string;
    displayText?: string;
    sortOrder: number;
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
    quantity: nonNegativeNumberSchema,
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
 * Image asset metadata for a recipe photo and its generated variants.
 */
export interface RecipePhoto {
    id: string;
    recipeId: string;
    s3KeyOrig: string;
    s3KeyThumb?: string;
    s3KeyCard?: string;
    s3KeyFull?: string;
    cdnUrlBase: string;
    processingStatus: PhotoProcessingStatus;
    sortOrder: number;
    createdAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link RecipePhoto}.
 */
export const recipePhotoSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    s3KeyOrig: z.string().min(1),
    s3KeyThumb: z.string().min(1).optional(),
    s3KeyCard: z.string().min(1).optional(),
    s3KeyFull: z.string().min(1).optional(),
    cdnUrlBase: z.string().url(),
    processingStatus: photoProcessingStatusSchema,
    sortOrder: nonNegativeIntSchema,
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
    quantity: nonNegativeNumberSchema,
    unit: z.string().min(1),
    displayText: z.string().min(1).optional(),
    userCalories: nonNegativeNumberSchema.optional(),
    userProteinG: nonNegativeNumberSchema.optional(),
    userCarbsG: nonNegativeNumberSchema.optional(),
    userFatG: nonNegativeNumberSchema.optional(),
});

/**
 * Input payload to create a new recipe.
 */
export interface CreateRecipeInput {
    title: string;
    description?: string;
    ingredients: CreateRecipeIngredientInput[];
    steps: string[];
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    servings?: number;
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
    steps: z.array(z.string().min(1)),
    prepTimeMinutes: nonNegativeIntSchema.optional(),
    cookTimeMinutes: nonNegativeIntSchema.optional(),
    servings: positiveIntSchema.optional(),
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
 * Single ranked hit in a recipe search response.
 */
export interface RecipeSearchResult {
    recipe: Recipe;
    rank?: number;
    highlights?: string[];
}

/**
 * Runtime validator for {@link RecipeSearchResult}.
 */
export const recipeSearchResultSchema = z.object({
    recipe: recipeSchema,
    rank: z.number().finite().optional(),
    highlights: z.array(z.string().min(1)).optional(),
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

/**
 * Stable identifier for a Home-screen widget (US-0 / FR-046). Each feature owns
 * its own widget id; the id is the anti-drift keystone shared by the three
 * layers of the Home surface — discovery (explicit startup registration),
 * composition ({@link CurateHomeWidgets}), and render (`React.lazy(load)` +
 * `Suspense` + a per-widget `ErrorBoundary`). In v1 the recipe widget is the
 * **only** live widget; gated widgets (backed by 005–009) are **ABSENT** — not
 * present-with-empty-state — and are added, each with its own loader, when its
 * feature package ships, at which point they auto-appear. Consumers MUST skip
 * unknown ids so an older client tolerates a newer server (graceful version
 * skew). See `research/home-widget-architecture.md` (DECISION section).
 */
export type HomeWidgetId = string;

/**
 * Lazy loader for a widget's platform component module — the "loader seam". It
 * resolves the dynamic import of a feature package's `./widget/web` or
 * `./widget/mobile` entry (never a component directly), so the render layer can
 * wrap it in `React.lazy` + `Suspense` + an `ErrorBoundary`, and so a widget can
 * later become a Module Federation remote one line at a time. Descriptors are
 * only registered for feature packages that exist; v1 registers just the recipe
 * widget's loader.
 */
export type HomeWidgetLoader = () => Promise<{ default: unknown }>;

/**
 * Descriptor a feature contributes for its Home widget via explicit startup
 * registration (the discovery layer). Colocated with the feature, so adding a
 * feature package makes its widget eligible without editing a central registry.
 */
export interface HomeWidgetDescriptor {
    id: HomeWidgetId;
    /** The loader seam; see {@link HomeWidgetLoader}. */
    load: HomeWidgetLoader;
    /**
     * Default ordering weight used when the viewer has no personalization
     * override for this widget; higher weights sort earlier.
     */
    defaultWeight: number;
    /**
     * Capability flag gating the widget on whether its backing service is live.
     * When the capability is absent from the viewer's live capabilities, the
     * widget is omitted **entirely** (ABSENT, not rendered as an empty tile).
     * This is what lets Home ship in v1 with only the recipe widget live while
     * gated widgets light up automatically as their services deploy.
     */
    capability?: string;
    /** Minimum subscription tier required for the widget to be eligible. */
    minTier?: string;
}

/**
 * Per-viewer curation context for {@link CurateHomeWidgets}: which capabilities
 * (backing services) are live, the viewer's subscription tier, and their
 * persisted personalization layout. The layout (`order` + `hidden`) is loaded
 * from and saved via `PATCH /v1/profiles/me`, which is **owned by the
 * identity service (002)** and merely **consumed** here — 001 does not own that
 * endpoint or a `home_layouts` store — the layout lives in the identity profile preferences (`profiles.preferences.homeLayout`).
 */
export interface HomeWidgetCurationContext {
    liveCapabilities: string[];
    tier?: string;
    order?: HomeWidgetId[];
    hidden?: HomeWidgetId[];
}

/**
 * Pure composition step (L2): given the registered descriptors and a viewer
 * context, return the ordered, capability- and tier-gated list of widgets to
 * render. A descriptor is dropped when its `capability` is not in
 * `liveCapabilities`, its `minTier` exceeds the viewer's tier, or its id is in
 * `hidden`; the survivors are ordered by the viewer's `order` and then by
 * `defaultWeight`. No side effects.
 */
export type CurateHomeWidgets = (
    widgets: readonly HomeWidgetDescriptor[],
    ctx: HomeWidgetCurationContext,
) => HomeWidgetDescriptor[];
