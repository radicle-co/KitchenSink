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
 * Allowed recipe difficulty values (CR-001 / FR-001b).
 */
export const RecipeDifficulty = {
    EASY: 'easy',
    MEDIUM: 'medium',
    HARD: 'hard',
} as const;

/**
 * Author-stated difficulty of a recipe.
 *
 * OPTIONAL wherever it appears: "the author did not state a difficulty" is a real state, and there is
 * no honest default for it. Consumers MUST render an absent difficulty as no badge — never as a
 * substituted or assumed value (FR-001b).
 */
export type RecipeDifficulty = (typeof RecipeDifficulty)[keyof typeof RecipeDifficulty];

/**
 * Runtime validator for {@link RecipeDifficulty}.
 */
export const recipeDifficultySchema = z.enum([RecipeDifficulty.EASY, RecipeDifficulty.MEDIUM, RecipeDifficulty.HARD]);

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
    /**
     * Author-stated difficulty (FR-001b). ABSENT when the author did not state one — consumers render
     * no badge rather than substituting a default. Never fabricated, never computed.
     */
    difficulty?: RecipeDifficulty;
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
     * Mean of this recipe's ratings, 1–5 (FR-013a). READ-ONLY — maintained by a database trigger and
     * never accepted from a client; rate via `PUT /v1/recipes/{id}/rating`.
     *
     * ABSENT exactly when {@link ratingCount} is 0. An unrated recipe has NO average — it is never
     * reported as `0`, which would render as a genuine zero-star score.
     */
    averageRating?: number;
    /**
     * Number of ratings contributing to {@link averageRating} (FR-013a). READ-ONLY; `0` when unrated.
     */
    ratingCount: number;
    /**
     * Whether this recipe uses a premium-only capability — the "PRO" badge (FR-003a).
     *
     * DERIVED on projection from `visibility` + `sourceType`; there is NO backing column and no
     * entitlement lookup. Do NOT re-derive this in a mapper, controller, or client: the single
     * authoritative implementation is {@link usesPremiumCapability}, which the list and detail
     * projections both call. When 010 ships real entitlements, that function is the only thing that
     * changes — this field does not.
     */
    usesPremiumCapability: boolean;
    /**
     * Absolute CDN URL of the recipe's cover photo (FR-001c) — the photo with the lowest sort order,
     * resolved deterministically. Present on the LIST projection so a card renders without an N+1
     * detail fetch; also present on detail, where it is the same photo as the first of `photos`.
     *
     * ABSENT when the recipe has no photos — never a placeholder or stock image URL.
     *
     * NOTE: photos are stored and served unprocessed with no derived variants, so this URL is the
     * FULL-SIZE original (up to 5 MB) even when painted into a thumbnail. See FOLLOW-UP-CR-001-A.
     */
    coverPhotoUrl?: string;
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
 * The single authoritative derivation of the "PRO" badge (FR-003a) — whether a recipe uses a
 * capability only a premium user has. Called by BOTH the list and the detail projection so they can
 * never disagree; never inlined or re-implemented elsewhere.
 *
 * The only premium-gated recipe capability today is CHOOSING private visibility. Note this is
 * deliberately NOT `visibility === 'private'`: per C-004, `imported_physical` and `imported_paid`
 * recipes are private for EVERY tier (their privacy is forced, not chosen), so badging them PRO would
 * mark a free-tier user's OCR import as premium content. That is latent today — 004 has not shipped,
 * so every row is `user_created` — which is exactly why it is encoded correctly now, while the rule
 * costs nothing to get right.
 *
 * When 010 ships real entitlements, this function is the one place the rule changes.
 *
 * @param recipe - The recipe's visibility and source type.
 * @returns True when the recipe uses a premium-only capability. Pure.
 */
export function usesPremiumCapability(recipe: Pick<Recipe, 'visibility' | 'sourceType'>): boolean {
    return (
        recipe.visibility === RecipeVisibility.PRIVATE &&
        (recipe.sourceType === RecipeSourceType.USER_CREATED || recipe.sourceType === RecipeSourceType.IMPORTED_PUBLIC)
    );
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
    difficulty: recipeDifficultySchema.optional(),
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
    // 1..5 mean; absent (not 0) when ratingCount is 0 — see the Recipe.averageRating docstring.
    averageRating: z.number().finite().min(1).max(5).optional(),
    ratingCount: nonNegativeIntSchema,
    usesPremiumCapability: z.boolean(),
    coverPhotoUrl: z.string().url().optional(),
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
    /** Household-measure portions (grams-per-unit), populated when the food resolves (#11). */
    portions?: IngredientPortion[];
    createdAt: IsoDateTimeString;
}

/** A household-measure portion normalized to grams per one unit (e.g. `{ unit: 'cup', gramsPerUnit: 125 }`). */
export interface IngredientPortion {
    unit: string;
    gramsPerUnit: number;
}

export const ingredientPortionSchema = z.object({
    unit: z.string().min(1),
    gramsPerUnit: positiveNumberSchema,
});

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
    portions: z.array(ingredientPortionSchema).optional(),
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

/** A recipe instruction step as returned on the wire (the read projection of {@link RecipeStep}). */
export interface RecipeStepView {
    stepNumber: number;
    instruction: string;
    timerSeconds?: number;
}

export const recipeStepViewSchema = z.object({
    stepNumber: positiveIntSchema,
    instruction: z.string().min(1),
    timerSeconds: nonNegativeIntSchema.optional(),
});

/** A recipe ingredient line as returned on the wire (the read projection of {@link RecipeIngredient}). */
export interface RecipeIngredientView {
    ingredientId: string;
    name: string;
    quantity: number;
    unit?: string;
    notes?: string;
    isUserEntered: boolean;
}

export const recipeIngredientViewSchema = z.object({
    ingredientId: idSchema,
    name: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    isUserEntered: z.boolean(),
});

/**
 * A recipe WITH its cookable content: the {@link Recipe} metadata PLUS the composed `ingredients`, `steps`,
 * and `photos`. Returned by the single-recipe reads (get/create/update/clone/restore); list/search return
 * the lighter {@link Recipe} metadata.
 */
/** Estimated PER-SERVING nutrition (FR-007), with `isComplete=false` when any line is unaccounted. */
export interface RecipeNutrition {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    isComplete: boolean;
}

export const recipeNutritionSchema = z.object({
    calories: nonNegativeNumberSchema,
    proteinG: nonNegativeNumberSchema,
    carbsG: nonNegativeNumberSchema,
    fatG: nonNegativeNumberSchema,
    isComplete: z.boolean(),
});

export interface RecipeDetail extends Recipe {
    ingredients: RecipeIngredientView[];
    steps: RecipeStepView[];
    photos: RecipePhoto[];
    nutrition: RecipeNutrition;
    /**
     * The VIEWER's OWN rating of this recipe, 1..5 (FR-013). Per-viewer and READ-ONLY — distinct from the
     * community `averageRating` (which remains the displayed score). Lets the rating control pre-select the
     * viewer's existing stars and reveal remove-on-load without a second request. ABSENT when the viewer has
     * not rated the recipe (and inherently absent on the viewer's own recipe — an owner cannot rate their
     * own). Detail projection ONLY; never on the list projection (which shows the community score).
     */
    viewerRating?: number;
}

export const recipeDetailSchema = recipeSchema.extend({
    ingredients: z.array(recipeIngredientViewSchema),
    steps: z.array(recipeStepViewSchema),
    photos: z.array(recipePhotoSchema),
    nutrition: recipeNutritionSchema,
    // 1..5 stars; absent (not 0) when the viewer has not rated — see the RecipeDetail.viewerRating docstring.
    viewerRating: z.number().int().min(1).max(5).optional(),
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
 * One user's star rating of one recipe (CR-001 / FR-013).
 *
 * Owned by the RATER (`userId`), not by the rated recipe's owner — which makes ratings the third
 * owner-scoped root GDPR erasure must reach, and the only one that routinely lives on another user's
 * row (FR-013b). At most one rating per (recipe, user): re-rating REPLACES.
 */
export interface RecipeRating {
    id: string;
    recipeId: string;
    /** App-user ULID of the RATER (not the recipe owner). */
    userId: string;
    /** Whole stars, 1–5 inclusive. */
    stars: number;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
}

/**
 * Runtime validator for {@link RecipeRating}.
 */
export const recipeRatingSchema = z.object({
    id: idSchema,
    recipeId: idSchema,
    userId: idSchema,
    stars: z.number().int().min(1).max(5),
    createdAt: isoDateTimeStringSchema,
    updatedAt: isoDateTimeStringSchema,
});

/**
 * Body of the idempotent `PUT /v1/recipes/{id}/rating` upsert (FR-013).
 *
 * The rater is taken from the authenticated token, never from the body — a client-supplied rater id
 * would let any caller rate as anyone else.
 */
export interface SetRecipeRatingInput {
    /** Whole stars, 1–5 inclusive. */
    stars: number;
}

/**
 * Runtime validator for {@link SetRecipeRatingInput}.
 */
export const setRecipeRatingInputSchema = z.object({
    stars: z.number().int().min(1).max(5),
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
    /** REQUIRED — the catalog `ingredients` row this line references (food-backed OR freeform). */
    ingredientId: string;
    /** Client display label; the server re-resolves the canonical catalog name (ADV-2). */
    name: string;
    quantity: number;
    unit?: string;
    /** Free-form display override (wire field `notes`; persisted as `displayText`). */
    notes?: string;
    userCalories?: number;
    userProteinG?: number;
    userCarbsG?: number;
    userFatG?: number;
}

/**
 * Runtime validator for {@link CreateRecipeIngredientInput}.
 */
export const createRecipeIngredientInputSchema = z.object({
    ingredientId: idSchema,
    name: z.string().min(1),
    quantity: positiveNumberSchema,
    unit: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
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
    /** Author-stated difficulty (FR-001b). Omit when the author states none — there is no default. */
    difficulty?: RecipeDifficulty;
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
    difficulty: recipeDifficultySchema.optional(),
    cuisine: z.string().min(1).optional(),
    dietaryFlags: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    visibility: recipeVisibilitySchema.optional(),
});

/**
 * Input payload to update an existing recipe with optimistic concurrency protection.
 *
 * Standard semantic: an OMITTED field is left unchanged.
 */
export interface UpdateRecipeInput extends Omit<Partial<CreateRecipeInput>, 'difficulty'> {
    expectedVersion: number;
    /**
     * Author-stated difficulty (FR-001b). Three distinct meanings, and they are not interchangeable:
     * omitted = leave unchanged; a value = set it; explicit `null` = CLEAR it back to "not stated".
     *
     * `null` is required because FR-001b makes "no difficulty" a first-class state: without an
     * explicit clear sentinel, `Partial<>`'s omitted-means-unchanged rule would make that state
     * reachable only at create time, so a user who ever set a difficulty could never remove it.
     */
    difficulty?: RecipeDifficulty | null;
}

/**
 * Runtime validator for {@link UpdateRecipeInput}.
 */
export const updateRecipeInputSchema = createRecipeInputSchema.partial().extend({
    expectedVersion: positiveIntSchema,
    // .nullable().optional() — the three-state field above: absent | value | null (clear).
    difficulty: recipeDifficultySchema.nullable().optional(),
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
    /**
     * The caller tried to rate their own recipe (FR-013) — always a 403, never a 404.
     *
     * Note the deliberate asymmetry with the other rating rejection: rating a recipe the caller cannot
     * SEE must return `RECIPE_NOT_FOUND` (404), because a 403 there would confirm the recipe exists.
     * Here the caller owns the recipe, so they already know it exists and there is nothing to leak.
     */
    CANNOT_RATE_OWN_RECIPE: 'CANNOT_RATE_OWN_RECIPE',
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
    RecipeErrorCode.CANNOT_RATE_OWN_RECIPE,
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
