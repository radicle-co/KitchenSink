/**
 * T023 — the `Recipe` response shape this vertical serializes (mirrors the `Recipe` schema in
 * `contracts/api.openapi.yaml`).
 *
 * The recipes vertical owns the golden `recipes` row + its ordered `recipe_steps`, so it fully
 * populates every recipe-level field and `steps`. The relational `ingredients` array is owned by the
 * ingredients vertical; until that vertical composes it into the detail response, this serializer emits
 * an empty `ingredients` array (the denormalized `ingredient_names_text` still drives search). Dates are
 * ISO 8601 strings, and `version` is the row's `currentVersion`.
 */
import type {
    RecipeDifficulty,
    RecipeNutrition,
    RecipePhoto,
    RecipeSourceType,
    RecipeVisibility,
} from '@kitchensink/recipe-core';

/** A serialized instruction step (`RecipeStep` in the contract). */
export interface RecipeStepResponse {
    stepNumber: number;
    instruction: string;
    timerSeconds?: number;
}

/** A serialized recipe ingredient line (`RecipeIngredientView` in the contract). */
export interface RecipeIngredientResponse {
    ingredientId: string;
    name: string;
    quantity: number;
    unit?: string;
    notes?: string;
    /** True for a freeform, user-entered line not backed by the food database (the UI "user-entered" badge). */
    isUserEntered: boolean;
}

/**
 * The recipe response envelope. A superset of the shared `recipe-core` `Recipe` (all of its metadata
 * fields, matching names + non-null times) PLUS the composed `ingredients` + `steps` content — i.e. the
 * `RecipeDetail` shape. Every field name mirrors `recipe-core` so a `Recipe`/`RecipeDetail` parses it.
 */
export interface RecipeResponse {
    id: string;
    ownerId: string;
    title: string;
    description?: string;
    cuisine?: string;
    visibility: RecipeVisibility;
    sourceType: RecipeSourceType;
    sourceUrl?: string;
    sourceAttribution?: string;
    clonedFromId?: string;
    hasSubstantiveEdit: boolean;
    hasPartialNutrition: boolean;
    ingredients: RecipeIngredientResponse[];
    steps: RecipeStepResponse[];
    servings: number;
    prepTimeMinutes: number;
    cookTimeMinutes: number;
    totalTimeMinutes: number;
    /** Author-stated difficulty (FR-001b). ABSENT when the author stated none — never a fabricated default. */
    difficulty?: RecipeDifficulty;
    tags: string[];
    dietaryFlags: string[];
    currentVersion: number;
    /**
     * Mean of this recipe's ratings, 1–5 (FR-013a). Trigger-maintained, READ-ONLY. ABSENT exactly when
     * {@link ratingCount} is 0 — an unrated recipe has no average, never reported as `0`.
     */
    averageRating?: number;
    /** Number of ratings behind {@link averageRating} (FR-013a). `0` when unrated. */
    ratingCount: number;
    /**
     * The VIEWER's OWN rating of this recipe, 1–5 (FR-013). Per-viewer and READ-ONLY — distinct from the
     * community {@link averageRating}, which stays the displayed score. Lets the rating control pre-select
     * the viewer's existing stars (and reveal remove-on-load) without a second round-trip. Populated ONLY
     * on the single-recipe DETAIL read (`getById`, and the rating write's detail response); ABSENT when the
     * viewer has not rated the recipe (and inherently absent on the owner's own recipe — an owner cannot
     * rate their own). Never emitted on the list projection (that shows the community score, not per-viewer
     * state — and a per-row lookup there would be an N+1).
     */
    viewerRating?: number;
    /**
     * The derived "PRO" badge (FR-003a) — DERIVED on projection via the single authoritative
     * `usesPremiumCapability()` in `recipe-core`, never stored, never re-derived elsewhere.
     */
    usesPremiumCapability: boolean;
    /**
     * Absolute CDN URL of the cover photo (FR-001c) — lowest sort_order, deterministic tiebreak. Present
     * on list (resolved via a cover LATERAL, no N+1) and on detail (the first of `photos`). ABSENT when
     * the recipe has no photos. NOTE: full-size original until FOLLOW-UP-CR-001-A lands (no thumbnails).
     */
    coverPhotoUrl?: string;
    createdAt: string;
    updatedAt: string;
    /** Soft-delete tombstone (C-007); present only when deleted, absent otherwise (never `null`). */
    deletedAt?: string;
    /**
     * The recipe's photos, embedded on the single-recipe DETAIL reads (get/create/update/clone/restore)
     * so the client renders the recipe in one round-trip. ABSENT on list/search (metadata) reads.
     */
    photos?: RecipePhoto[];
    /** Estimated per-serving nutrition (FR-007). Present on the DETAIL reads; absent on list/search. */
    nutrition?: RecipeNutrition;
}

/** A paginated list of recipes (`PaginatedResponse<Recipe>` in the contract). */
export interface PaginatedRecipesResponse {
    data: RecipeResponse[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
