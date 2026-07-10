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
import type { RecipeVisibility } from '@kitchensink/recipe-core';

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

/** The `Recipe` response envelope. */
export interface RecipeResponse {
    id: string;
    ownerId: string;
    title: string;
    description?: string;
    cuisine?: string;
    visibility: RecipeVisibility;
    ingredients: RecipeIngredientResponse[];
    steps: RecipeStepResponse[];
    servings: number;
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
    totalTimeMinutes: number | null;
    tags: string[];
    dietaryFlags: string[];
    version: number;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
}

/** A paginated list of recipes (`PaginatedResponse<Recipe>` in the contract). */
export interface PaginatedRecipesResponse {
    data: RecipeResponse[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
