/** @module @kitchensink/recipe-core — Shared types and Zod schemas for Commise recipe management */

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
 * Publication status of a recipe (W8-a.3 / decision 5). ORTHOGONAL to {@link RecipeVisibility}: a `draft`
 * is visible ONLY to its owner regardless of visibility (a free-tier draft is `public`, so the visibility
 * check alone would leak it). This is a SECURITY boundary — a draft is absent from every non-owner read
 * path and is not rateable (404, like a tombstone). Every existing recipe is `published` (the honest,
 * load-bearing default).
 */
export const RecipeStatus = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
} as const;

/**
 * Publication state for a recipe.
 */
export type RecipeStatus = (typeof RecipeStatus)[keyof typeof RecipeStatus];

/**
 * Runtime validator for {@link RecipeStatus}.
 */
export const recipeStatusSchema = z.enum([RecipeStatus.DRAFT, RecipeStatus.PUBLISHED]);

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
 * Curated cuisine choices offered by the recipe editor's cuisine dropdown (w3/e5). UNLIKE
 * {@link RecipeDifficulty}/{@link RecipeStatus}, this is deliberately NOT a closed enum on the wire: `cuisine`
 * stays `string | undefined` on every recipe/create/update type and schema (`z.string().min(1).optional()`,
 * unchanged) so an existing recipe whose cuisine predates this list — or a future cuisine nobody curated yet
 * — is never rejected or silently coerced. `CUISINES` exists purely to drive the editor's suggested-choices
 * dropdown; the array is ordered for display, not for lookup.
 */
export const CUISINES = [
    'Italian',
    'Mexican',
    'Chinese',
    'Indian',
    'Japanese',
    'Thai',
    'French',
    'Mediterranean',
    'American',
    'Middle Eastern',
    'Korean',
    'Vietnamese',
    'Spanish',
    'Greek',
    'Other',
] as const;

/**
 * One curated cuisine choice from {@link CUISINES}. NOT the type of the `cuisine` wire field (which stays
 * `string`) — this only types a value drawn from the curated list itself.
 */
export type Cuisine = (typeof CUISINES)[number];

/**
 * Sort options supported by recipe search.
 */
export const RecipeSearchSortBy = {
    RELEVANCE: 'relevance',
    RECENT: 'recent',
    TITLE: 'title',
    /** Most-cloned first (W8-a.9 / FR — popularity) — ordered by how many recipes were cloned from it. */
    MOST_CLONED: 'most-cloned',
    /** Quickest first (W8-a.9) — ascending total time (prep + cook + inactive). */
    QUICKEST: 'quickest',
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
    RecipeSearchSortBy.MOST_CLONED,
    RecipeSearchSortBy.QUICKEST,
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
    /**
     * Publication status (W8-a.3 / decision 5). `draft` recipes are owner-only regardless of `visibility`
     * and are excluded from every non-owner read path (search, list, community, collection-embed) and from
     * rating — a SECURITY boundary, not a display flag. Every recipe has a status (NOT NULL, default
     * `published`). On the owner's own list a `draft` renders a "Draft" badge that REPLACES the visibility
     * badge (never "Public" on a draft, which would mislead).
     */
    status: RecipeStatus;
    sourceType: RecipeSourceType;
    sourceUrl?: string;
    sourceAttribution?: string;
    clonedFromId?: string;
    hasSubstantiveEdit: boolean;
    cuisine?: string;
    dietaryFlags: string[];
    tags: string[];
    hasPartialNutrition: boolean;
    /**
     * Headline per-serving calories for card display (FR-007 / W8-a.1) — a DENORMALIZED value recomputed at
     * write time from the recipe's ingredient lines (single source: the service's `leadCaloriesPerServing`),
     * so the LIST, SEARCH, and collection-embed projections render it WITHOUT the N+1 a full nutrition read
     * would cost. On detail it agrees with `nutrition.calories`.
     *
     * ABSENT when the recipe has no accounted nutrition — never reported as `0` (which would read as a
     * genuine zero-calorie figure), mirroring {@link averageRating}.
     */
    leadCaloriesPerServing?: number;
    /**
     * The recipe author's display name (W8-a.2 / decision 6) — the "by @handle" cards render. DENORMALIZED
     * from the identity service's `profiles.displayName` at write time (no cross-service read); kept current
     * by the handle-sync fan-out. ABSENT for a pre-feature recipe until its next write / the backfill — the
     * UI falls back to a neutral label rather than fabricating. Never an authz/join key; `ownerId` stays that.
     */
    authorHandle?: string;
    currentVersion: number;
    /**
     * Mean of this recipe's ratings, 1–5 (FR-013a). READ-ONLY — maintained by a database trigger and
     * never accepted from a client; rate via `PUT /api/v1/recipes/{id}/rating`.
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
    // Publication status (W8-a.3) — NOT NULL, default 'published'; a draft is owner-only (security boundary).
    status: recipeStatusSchema,
    sourceType: recipeSourceTypeSchema,
    sourceUrl: z.string().url().optional(),
    sourceAttribution: z.string().min(1).optional(),
    clonedFromId: idSchema.optional(),
    hasSubstantiveEdit: z.boolean(),
    cuisine: z.string().min(1).optional(),
    dietaryFlags: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
    hasPartialNutrition: z.boolean(),
    // Denormalized headline per-serving calories (W8-a.1); absent (not 0) when no accounted nutrition.
    leadCaloriesPerServing: nonNegativeNumberSchema.optional(),
    authorHandle: z.string().min(1).optional(),
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
 * A recipe instruction step as returned on the wire (the read projection of {@link RecipeStep} — no
 * persistence ids). `stepNumber` is the 1-based display order; `timerSeconds` is an optional inline timer.
 */
export interface RecipeStepView {
    stepNumber: number;
    instruction: string;
    timerSeconds?: number;
}

/**
 * Runtime validator for {@link RecipeStepView}.
 */
export const recipeStepViewSchema = z.object({
    stepNumber: positiveIntSchema,
    instruction: z.string().min(1),
    timerSeconds: nonNegativeIntSchema.optional(),
});

/**
 * A recipe ingredient line as returned on the wire (the read projection of {@link RecipeIngredient}). It
 * carries exactly what the recipe-detail UI renders: the resolved catalog `name`, the `quantity`/`unit`,
 * an optional free-form `notes` override, and `isUserEntered` (the "user-entered" badge — a freeform line
 * not backed by the food database). Per-line nutrition and persistence ids stay server-side.
 */
export interface RecipeIngredientView {
    ingredientId: string;
    name: string;
    quantity: number;
    unit?: string;
    notes?: string;
    isUserEntered: boolean;
}

/**
 * Runtime validator for {@link RecipeIngredientView}.
 */
export const recipeIngredientViewSchema = z.object({
    ingredientId: idSchema,
    name: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    isUserEntered: z.boolean(),
});

/**
 * A recipe WITH its cookable content: the {@link Recipe} metadata PLUS the composed `ingredients` and
 * `steps`. This is what the single-recipe read paths return (`GET /api/v1/recipes/{id}`, create, update,
 * clone, restore) — everything a cook needs to follow the recipe. List/search/collection endpoints
 * return the lighter {@link Recipe} metadata (no per-item content).
 */
/**
 * Estimated PER-SERVING nutrition for a recipe (FR-007). Summed from each ingredient line — a line's
 * user-entered override (FR-007a) when present, otherwise the food-database per-100g values scaled by the
 * line's mass — then divided by servings. `isComplete` is `false` when any line could not be fully
 * accounted (a food still resolving, a freeform line with no nutrition, or a non-mass unit whose gram
 * weight is not known); the UI shows the estimate with a "partial" caveat rather than a false-precise total.
 */
export interface RecipeNutrition {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    isComplete: boolean;
}

/**
 * Runtime validator for {@link RecipeNutrition}.
 */
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
    /** The recipe's photos in display order (empty until any are uploaded), embedded for a one-round-trip detail. */
    photos: RecipePhoto[];
    /** Estimated per-serving nutrition (FR-007), with an `isComplete` flag when any line is unaccounted. */
    nutrition: RecipeNutrition;
    /**
     * The VIEWER's OWN rating of this recipe, 1–5 (FR-013). Per-viewer and READ-ONLY — deliberately DISTINCT
     * from {@link Recipe.averageRating}, which is the COMMUNITY score and remains the displayed social-proof
     * value: `viewerRating` is the rating INPUT's pre-selected state, `averageRating` is the DISPLAY. Lets the
     * rating control pre-select the viewer's existing stars and reveal remove-on-load without a second request.
     *
     * ABSENT when the viewer has not rated the recipe (and inherently absent on the viewer's OWN recipe — an
     * owner cannot rate their own). Never `0`: an unrated viewer has no stars, not a zero-star rating. Detail
     * projection ONLY (`GET /api/v1/recipes/{id}` and the rating write's detail response); never on the lighter
     * list/search {@link Recipe} projection, which carries only the community score.
     */
    viewerRating?: number;
}

// NB: `recipeDetailSchema` is defined AFTER `recipePhotoSchema` (below) — it references it, and a `const`
// is not hoisted, so defining it here would hit the temporal dead zone at module load.

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
/**
 * A household-measure portion for an ingredient, normalized to grams PER ONE unit (e.g. `{ unit: 'cup',
 * gramsPerUnit: 125 }`). Derived from the food service's portions when a food resolves; used to convert a
 * recipe line measured in a volumetric/count unit (cup/tbsp/clove) into grams for nutrition scaling.
 */
export interface IngredientPortion {
    /** The normalized measure unit (lower-case, singular, abbreviations expanded — e.g. `tablespoon`). */
    unit: string;
    /** Grams for ONE of `unit`. */
    gramsPerUnit: number;
}

/**
 * Runtime validator for {@link IngredientPortion}.
 */
export const ingredientPortionSchema = z.object({
    unit: z.string().min(1),
    gramsPerUnit: positiveNumberSchema,
});

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
    /** Household-measure portions (normalized to grams-per-unit) — populated when the food resolves. */
    portions?: IngredientPortion[];
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
    // NOT `.min(1)`: `recipe_ingredients.unit` is a NOT NULL column whose "unitless" value is the EMPTY
    // STRING ("2 eggs", "1 lemon" — the create/update DTO's `unit` is optional and the service persists
    // `line.unit ?? ''`), and the version snapshot copies the column verbatim. A non-empty constraint here
    // rejected the service's own output, so the ENTIRE version-history list failed client-side parsing for
    // any recipe carrying a unitless line — see `recipe.types.test.ts`'s version-contract suite.
    unit: z.string(),
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
 * Per-recipe photo cap (data-model.md / T035) — the single source shared by the server DAL
 * (`recipe-service/src/photos/dal/photos.dal.ts`, which enforces it as `MAX_PHOTOS_EXCEEDED`) and the
 * client photo manager (`@commise/features-recipes`'s `isAtPhotoCap`, which hides the add control at cap).
 */
export const MAX_RECIPE_PHOTOS = 10;

/**
 * The hard per-photo upload size bound: 5 MB (REQ-009/REQ-011). Single source shared by the server's
 * presign/confirm bound (`recipe-service/src/photos/photos.service.ts`'s `MAX_UPLOAD_BYTES`, which
 * re-exports this constant rather than declaring its own literal) and the client's pre-transmission size
 * guard (`@commise/features-recipes`'s `validatePhotoFile`, REQ-011) — identical knowledge on both sides,
 * so it lives in exactly one place.
 */
export const MAX_RECIPE_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The canonical recipe-photo MIME allowlist per REQ-012/REQ-013 — the SINGLE source of truth shared by
 * the CLIENT'S pre-transmission guard (`@commise/features-recipes`'s `validatePhotoFile`, REQ-012) and the
 * SERVER'S magic-byte revalidation allowlist (`recipe-service/src/photos/photos.service.ts`'s
 * `ALLOWED_UPLOAD_CONTENT_TYPES`, REQ-013) — both re-export/consume this constant so the two can never
 * silently drift apart again.
 *
 * HEIC/HEIF are deliberately EXCLUDED, even though the original spec draft (REQ-012/REQ-013 as first
 * written) named all five types: the server's photo pipeline cannot actually deliver them end to end.
 * `file-type` DOES recognize HEIC/HEIF magic bytes, but the recipe-service's installed `sharp` build's
 * `heif` codec decodes AVIF only — it has no HEVC/H.265 decoder (that codec is patent-encumbered and not
 * bundled in prebuilt `sharp`/libvips binaries) — so a real iPhone HEIC upload would pass magic-byte
 * detection and then fail cover-thumbnail generation. Rather than let the client accept a format the
 * server would only ever accept-but-never-thumbnail (a real client/server divergence), HEIC/HEIF support
 * is deferred; see `specs/001-commise-recipe-app/v-model/waivers.md` WAV-001. Widen this list (and the
 * matching `image-content-type` detector) only once the pipeline is verified to genuinely decode + rewrite
 * HEIC/HEIF end to end.
 */
export const ALLOWED_RECIPE_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** One of the {@link ALLOWED_RECIPE_PHOTO_MIME_TYPES} the client's pre-transmission guard accepts. */
export type AllowedRecipePhotoMimeType = (typeof ALLOWED_RECIPE_PHOTO_MIME_TYPES)[number];

/**
 * Image asset metadata for a recipe photo. A photo is a SINGLE stored object served as-is via the CDN —
 * there are no derived variants and no processing lifecycle (data-model.md / T035). The server resolves
 * the full CDN `url` for the object (clients never concatenate a base + key), and `order` is the 1-based
 * display position within the recipe's photos (1…{@link MAX_RECIPE_PHOTOS}).
 */
export interface RecipePhoto {
    id: string;
    recipeId: string;
    /** The object key in S3. */
    key: string;
    /** The fully-resolved CDN URL the client renders. */
    url: string;
    /** The stored (magic-byte-detected) content type, e.g. `image/jpeg`. */
    contentType: string;
    /** 1-based display order within the recipe's photos. */
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
 * Runtime validator for {@link RecipeDetail}. Defined here (after {@link recipePhotoSchema}) so its
 * `photos` reference resolves — a `const` is not hoisted, so it cannot sit next to the interface above.
 */
export const recipeDetailSchema = recipeSchema.extend({
    ingredients: z.array(recipeIngredientViewSchema),
    steps: z.array(recipeStepViewSchema),
    photos: z.array(recipePhotoSchema),
    nutrition: recipeNutritionSchema,
    // 1..5 whole stars; absent (never 0) when the viewer has not rated — see the RecipeDetail.viewerRating
    // docstring. The schema is non-strict, so without this line the client would silently STRIP the field.
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
    /**
     * The version editor's display name (W8-a.2 / decision 6) — the "by @handle" the version-history
     * attribution renders. DENORMALIZED from `profiles.displayName` at write time and kept current by the
     * handle-sync fan-out (a mutable column, NOT frozen in the snapshot). ABSENT for a pre-feature version;
     * the editor is `createdBy` (the ULID), always the authoritative identity.
     */
    editorHandle?: string;
    /**
     * The device that authored this version (W8-a.6 / FR-007b) — bounded free text captured from the write
     * request. ABSENT for versions written before the field existed (or when the client sent none); the UI
     * renders "unknown device" rather than a fabricated value. User-controlled → ALWAYS escaped at render
     * (both the version-history attribution and the conflict banner), never `dangerouslySetInnerHTML`.
     */
    deviceLabel?: string;
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
    // Device attribution (W8-a.6) — bounded free text; absent for pre-feature versions / when unsent.
    deviceLabel: z.string().min(1).max(80).optional(),
    editorHandle: z.string().min(1).optional(),
    createdAt: isoDateTimeStringSchema,
});

/**
 * One side of a version conflict (W8-a.5) — a full content snapshot at a version, plus its identifying
 * metadata. Used for BOTH the `base` (the version the client edited from) and the `server` (the current
 * winning version) so the conflict UI can 3-way merge without a second round-trip.
 */
export interface VersionConflictSide {
    /** The version number this snapshot is at. */
    versionNumber: number;
    /** The device that authored this version (W8-a.6), when known. */
    deviceLabel?: string;
    /** When this version was written (ISO-8601). */
    updatedAt: IsoDateTimeString;
    /** The full recipe content at this version. */
    snapshot: RecipeSnapshot;
}

/**
 * Runtime validator for {@link VersionConflictSide}.
 */
export const versionConflictSideSchema = z.object({
    versionNumber: positiveIntSchema,
    deviceLabel: z.string().min(1).max(80).optional(),
    updatedAt: isoDateTimeStringSchema,
    snapshot: recipeSnapshotSchema,
});

/**
 * The `details` payload of a `409 VERSION_CONFLICT` (W8-a.5 / FR-007c). Beyond the two version NUMBERS,
 * it carries the `server` (current winning) snapshot and — when still within the DB retention window — the
 * `base` (the version the client edited from), read COHERENTLY with the rejected optimistic-concurrency
 * guard so a third concurrent writer cannot make `server` a version ahead of the one the guard compared
 * against. `currentVersion` is the concurrency token the resolve write echoes back as `expectedVersion`;
 * `base` is present so the OQ-1 in-editor rebase needs no extra fetch. A NON-owner update never produces
 * this body — it gets a plain 404 (W8-a.4).
 */
export interface VersionConflictDetails {
    /** The recipe's current (winning) version — the token the resolve CAS echoes as `expectedVersion`. */
    currentVersion: number;
    /** The stale version the client based its edit on (its `expectedVersion`). */
    conflictingVersion: number;
    /** The current winning version's snapshot + metadata. */
    server: VersionConflictSide;
    /** The version the client edited from, when still retained in the DB window (else absent → S3 via W8-a.7). */
    base?: VersionConflictSide;
}

/**
 * Runtime validator for {@link VersionConflictDetails}.
 */
export const versionConflictDetailsSchema = z.object({
    currentVersion: positiveIntSchema,
    conflictingVersion: positiveIntSchema,
    server: versionConflictSideSchema,
    base: versionConflictSideSchema.optional(),
});

/**
 * Response to a version restore (`POST /api/v1/recipes/{id}/versions/{versionNumber}/restore`): the recipe
 * after the restore, the version it was restored FROM, and the recipe's new current version number.
 */
export interface RestoreVersionResponse {
    recipe: RecipeDetail;
    restoredFromVersion: number;
    currentVersion: number;
}

/**
 * Runtime validator for {@link RestoreVersionResponse}.
 */
export const restoreVersionResponseSchema = z.object({
    recipe: recipeDetailSchema,
    restoredFromVersion: positiveIntSchema,
    currentVersion: positiveIntSchema,
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
 * Body of the idempotent `PUT /api/v1/recipes/{id}/rating` upsert (FR-013).
 *
 * The rater is taken from the authenticated token, never from the body — a client-supplied rater id
 * would let any caller rate as anyone else. The schema is non-strict (unknown keys are stripped), so a
 * body carrying a spoofed `userId` parses to `{ stars }` only.
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
    /**
     * Reuses {@link RecipeVisibility} (`'public' | 'private'`) rather than a separate
     * collection-scoped union — the server's `CollectionVisibility` enum has the identical
     * value set, and the two concepts are the same thing at different layers. Always present:
     * the server sends it on every collection read (list and single).
     */
    visibility: RecipeVisibility;
    description?: string;
    /**
     * Set when this collection was cloned from another collection (FR-011).
     * Pull-from-source updates are explicit and opt-in; this field never causes
     * implicit re-sync of recipe membership.
     */
    sourceCollectionId?: string;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
    /** Member recipe count; present only on single-collection reads (absent on list reads). */
    recipeCount?: number;
}

/**
 * Runtime validator for {@link Collection}.
 */
export const collectionSchema = z.object({
    id: idSchema,
    ownerId: idSchema,
    name: z.string().min(1),
    visibility: recipeVisibilitySchema,
    description: z.string().min(1).optional(),
    sourceCollectionId: idSchema.optional(),
    createdAt: isoDateTimeStringSchema,
    updatedAt: isoDateTimeStringSchema,
    recipeCount: z.number().int().nonnegative().optional(),
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
    /**
     * The catalog `ingredients` row this line references — REQUIRED. Both food-backed and freeform
     * (user-entered) ingredients are first created in the catalog, so a recipe line always points at an
     * existing id; the server rejects an unknown id with `UNKNOWN_INGREDIENT` (400).
     */
    ingredientId: string;
    /** The client's display label. The server re-resolves the CANONICAL name from the catalog (ADV-2). */
    name: string;
    quantity: number;
    unit?: string;
    /** Free-form display override (wire field `notes`; persisted as `displayText`). */
    notes?: string;
    /** Per-line user-entered nutrition override (FR-007a) — absolute for this line's quantity. */
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
 *
 * `servings` and all three timings are REQUIRED — the server's create contract requires them, and
 * `totalTimeMinutes` is an independent value (not derived from prep + cook: a recipe may have inactive
 * time — rest, marinate, chill — that belongs in the total but in neither prep nor cook). Making them
 * required here means the typed client can only build an accepted create body (resolves divergence #5).
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
    /**
     * Publication status (W8-a.3). OPTIONAL: absent leaves it unchanged on update (the server defaults a
     * create to `published` when omitted). The wizard's Save Draft sends `draft`; Publish sends `published`;
     * the plain (non-wizard) "Save changes" path omits it entirely so it never flips an existing recipe's
     * publication state as a side effect of an unrelated edit.
     */
    status?: RecipeStatus;
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
    status: recipeStatusSchema.optional(),
});

/**
 * Input payload to update an existing recipe with optimistic concurrency protection.
 *
 * Standard semantic: an OMITTED field is left unchanged. `difficulty` is the deliberate exception (it
 * is three-state — see below), so it is excluded from the inherited `Partial<CreateRecipeInput>` and
 * re-declared with the `| null` clear sentinel.
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
    maxCookTime?: number;
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
    maxCookTime: nonNegativeIntSchema.optional(),
    maxTotalTime: nonNegativeIntSchema.optional(),
    ingredientIds: z.array(idSchema).optional(),
    page: positiveIntSchema.optional(),
    pageSize: positiveIntSchema.optional(),
    sortBy: recipeSearchSortBySchema.optional(),
});

/**
 * Single ranked hit in a recipe search response. An object-per-hit envelope (not a bare `Recipe`) so
 * future per-result metadata is an ADDITIVE field, never a breaking reshape. `rank` is the relevance
 * score, present only for a text query (omitted in browse mode).
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
 * One facet bucket in a search response: a facet value and how many sampled matches carry it. An
 * object-per-bucket (not a `{ value: count }` map) so a bucket can grow additional metadata — a display
 * label, a selected flag, an explicit order — without a breaking reshape.
 */
export interface RecipeFacetCount {
    value: string;
    count: number;
}

/**
 * Runtime validator for {@link RecipeFacetCount}.
 */
export const recipeFacetCountSchema = z.object({
    value: z.string().min(1),
    count: nonNegativeIntSchema,
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
    /**
     * A pull-from-source commit was rejected because the diff drifted since the client's preview (W8-a.8 /
     * decision 7) — the source membership OR the caller's own clone membership changed. A 409; `details`
     * carries the fresh `{ added, removed, unchanged }` so the client can re-preview rather than silently
     * applying a different set than the user confirmed.
     */
    PULL_DRIFT: 'PULL_DRIFT',
    /**
     * REQ-049b — the caller already owns the maximum of 50 (non-deleted) collections, so a further
     * `POST /api/v1/collections` is rejected before any row is written. A 409, matching `MAX_PHOTOS_EXCEEDED`'s
     * treatment of a resource-count cap; `details` carries the `limit` for the client.
     */
    COLLECTION_LIMIT_REACHED: 'COLLECTION_LIMIT_REACHED',
    ERASURE_IN_PROGRESS: 'ERASURE_IN_PROGRESS',
    UNKNOWN_INGREDIENT: 'UNKNOWN_INGREDIENT',
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
 * Machine-readable `code` the recipe API returns on a `401` when the session token verified but carried
 * **no `external_id`** (app-user ULID) claim — the *first-token sync race* (a just-created user whose
 * ULID identity (002) has not yet backfilled to Clerk). Deliberately distinct from a hard auth failure:
 * clients detect this specific code to **refresh the token and retry with backoff** (giving the identity
 * webhook time to sync) rather than surfacing an error. The server `AuthMiddleware` sets it; the
 * `RecipeServiceClient` retries on it. Not a {@link RecipeErrorCode} — it is an auth/transport signal,
 * never a recipe-domain error, and the owner key still NEVER falls back to the Clerk `sub`.
 */
export const IDENTITY_SYNC_PENDING_CODE = 'IDENTITY_SYNC_PENDING';

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
    RecipeErrorCode.PULL_DRIFT,
    RecipeErrorCode.COLLECTION_LIMIT_REACHED,
    RecipeErrorCode.ERASURE_IN_PROGRESS,
    RecipeErrorCode.UNKNOWN_INGREDIENT,
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

/**
 * Type guard for {@link RecipeError}. Because `RecipeError` is a structural
 * contract (not an `Error` subclass), the check is structural: a value is a
 * `RecipeError` when it carries a known {@link RecipeErrorCode} `code` and a
 * non-empty `message`. This deliberately rejects a plain `Error` (which has a
 * `message` but no domain `code`), `null`/`undefined`, and primitives, so the
 * API exception filter can distinguish thrown domain errors from everything
 * else and map them to the correct HTTP status.
 */
export const isRecipeError = (value: unknown): value is RecipeError => recipeErrorSchema.safeParse(value).success;
