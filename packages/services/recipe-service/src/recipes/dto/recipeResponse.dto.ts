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
    RecipeImpact,
    IngredientQuantity,
    RecipeDifficulty,
    RecipeNutrition,
    RecipePhoto,
    RecipeSourceType,
    RecipeStatus,
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
    /** What the source stated — one value, two bounds, or nothing (U8/KTD-6). Never a bare number. */
    quantity: IngredientQuantity;
    unit?: string;
    notes?: string;
    /** How THIS recipe prepares the food (plan U26). ⛔ Never part of {@link name}. */
    preparation?: string;
    /** The section this line belongs to (plan U27). Absent means ungrouped, which is most lines. */
    groupLabel?: string;
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
    /**
     * Publication status (W8-a.3). A `draft` is owner-only (excluded from every non-owner read path); the
     * owner's own list renders a "Draft" badge off this. Always present (NOT NULL column, default published).
     */
    status: RecipeStatus;
    sourceType: RecipeSourceType;
    sourceUrl?: string;
    sourceAttribution?: string;
    clonedFromId?: string;
    hasSubstantiveEdit: boolean;
    /*
     * ⛔ NO `leadCaloriesPerServing`. It was the W8-a.1 denormalization, and its own docstring gave the game
     * away — "on detail it agrees with `nutrition.calories`" is a statement that one fact had two wire
     * representations. Migration 0019 dropped the column behind it and ADR-0021 moved a card's figure to
     * `POST /api/v1/recipes/nutrition-batch`; what remained was the detail read echoing its own
     * `nutrition.calories` back under a second name. Removed (ADR-0021's "Follow-up owed"). The detail's
     * calorie figure is `nutrition`, and there is no other.
     */
    ingredients: RecipeIngredientResponse[];
    /**
     * U13 (R20): on a CLONE response only — how many source lines were UNBOUND because they referenced
     * another author's private food (they arrive as user-entered lines, re-resolvable in the picker).
     * The one-time "N ingredients need re-matching" banner's number; absent on every other read, and on
     * a clone that unbound nothing, so the ordinary wire bytes are unchanged.
     */
    cloneUnboundLineCount?: number;
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
    /**
     * The folded lifetime counts (ADR-0030 §8) — DETAIL reads only, composed by the controller from
     * `recipe_impact_signals`. ABSENT means UNKNOWN (the analytics read degraded); a never-saved,
     * never-viewed recipe is `{ saveCount: 0, viewCount: 0 }`.
     */
    impact?: RecipeImpact;
}

/** A paginated list of recipes (`PaginatedResponse<Recipe>` in the contract). */
export interface PaginatedRecipesResponse {
    data: RecipeResponse[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
