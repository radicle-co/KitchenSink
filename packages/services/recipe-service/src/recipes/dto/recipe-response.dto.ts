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
import type { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

/** A serialized instruction step (`RecipeStep` in the contract). */
export interface RecipeStepResponse {
    stepNumber: number;
    instruction: string;
    timerSeconds?: number;
}

/** A serialized recipe ingredient line (`RecipeIngredient` in the contract). */
export interface RecipeIngredientResponse {
    ingredientId: string;
    name: string;
    quantity: number;
    unit?: string;
    notes?: string;
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
    tags: string[];
    dietaryFlags: string[];
    currentVersion: number;
    createdAt: string;
    updatedAt: string;
    /** Soft-delete tombstone (C-007); present only when deleted, absent otherwise (never `null`). */
    deletedAt?: string;
}

/** A paginated list of recipes (`PaginatedResponse<Recipe>` in the contract). */
export interface PaginatedRecipesResponse {
    data: RecipeResponse[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
