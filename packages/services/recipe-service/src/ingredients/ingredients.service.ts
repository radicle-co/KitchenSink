/**
 * T028 — `IngredientsService`: the ingredient picker's business logic, orchestrating the shared
 * `ingredients` catalog (via {@link IngredientsDal}) and the source-agnostic food service (via
 * `@kitchensink/food-service-client`, NEVER USDA directly).
 *
 * Async food resolution is first-class (data-model R5 / FR-007):
 *   - **search / typeahead** — {@link IngredientsService.search} does local fuzzy + FTS catalog search;
 *     {@link IngredientsService.suggestFoods} proxies `foodClient.search` for known-food typeahead.
 *   - **addByName** — `foodClient.addByName` returns `202` (`PENDING` / `UNRESOLVED`); we persist a
 *     food-backed catalog row (deduped on the opaque `food_id`) and return it immediately with its
 *     non-terminal status, so the picker can render a "nutrition pending" state.
 *   - **poll** — {@link IngredientsService.refreshStatus} re-reads `foodClient.getStatus`; on `RESOLVED`
 *     it persists the golden-record per-100g nutrition, otherwise it just advances the stored status.
 *   - **disambiguation** — {@link IngredientsService.getCandidates} + {@link IngredientsService.resolve}
 *     drive an `UNRESOLVED` food through `getCandidates` / `resolve(id, candidateIds)`.
 *   - **terminal** — a `NOT_FOUND` / `FAILED` food is written back as the ingredient's terminal status;
 *     the caller surfaces an error, offers a freeform fallback ({@link IngredientsService.createFreeform},
 *     `is_user_entered = true`), and allows removal. A terminal food never throws out of the poll.
 *
 * @implements FR-007 FR-007a
 */
import { Injectable } from '@nestjs/common';
import { RecipeErrorCode } from '@kitchensink/recipe-core';
import type { Ingredient, RecipeError } from '@kitchensink/recipe-core';
import { FoodServiceClient, isNotFoundError } from '@kitchensink/food-service-client';
import type { CandidateView, FoodStatus, FoodView, SearchResultView } from '@kitchensink/food-service-client';

import { IngredientsDal, type IngredientNutrition } from './dal/ingredients.dal.js';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';

/**
 * The food client's `FoodStatus` and recipe-core's `FoodResolutionStatus` are the SAME UPPER_SNAKE
 * union by design (they mirror each other); this identity conversion documents the crossing of the
 * package boundary without any runtime remap.
 */
function toResolutionStatus(status: FoodStatus): FoodResolutionStatus {
    return status as FoodResolutionStatus;
}

/** Case-insensitively find the per-100g amount for the first matching nutrient name. Pure. */
function nutrientPer100g(
    nutrients: readonly FoodView['nutrients'][number][],
    matches: (name: string) => boolean,
): number | undefined {
    const hit = nutrients.find((n) => n.basis === 'per_100g' && matches(n.nutrient.toLowerCase()));

    return hit?.amount;
}

/** Project a `RESOLVED` golden record's nutrients into the ingredient's per-100g nutrition columns. Pure. */
export function extractNutrition(food: FoodView): IngredientNutrition {
    const n = food.nutrients;

    return {
        caloriesPer100g: nutrientPer100g(n, (name) => name.includes('energy') || name.includes('calorie')),
        proteinGPer100g: nutrientPer100g(n, (name) => name.includes('protein')),
        carbsGPer100g: nutrientPer100g(n, (name) => name.includes('carbohydrate')),
        fatGPer100g: nutrientPer100g(n, (name) => name.includes('lipid') || name.includes('fat')),
    };
}

@Injectable()
export class IngredientsService {
    public constructor(
        private readonly dal: IngredientsDal,
        private readonly foodClient: FoodServiceClient,
    ) {}

    /**
     * Local catalog search (fuzzy `pg_trgm` + tsvector FTS) for the `GET /v1/ingredients/search`
     * autocomplete. Returns already-known catalog ingredients (with any resolved nutrition).
     *
     * @param query - The raw user query (trimmed here).
     * @param limit - Optional max hits (clamped by the DAL).
     * @returns Ranked catalog ingredients.
     * @sideEffect Reads `ingredients`.
     */
    public async search(query: string, limit?: number): Promise<Ingredient[]> {
        return this.dal.search(query.trim(), limit);
    }

    /**
     * Known-food typeahead: proxies `foodClient.search` (local `/v1/foods/search`, never a source) so the
     * picker can suggest foods that are not yet in the 001 catalog before an {@link addByName}.
     *
     * @param query - The raw user query (trimmed here).
     * @returns The ranked food-service search hits (empty on no local match).
     * @sideEffect Performs an authenticated food-service HTTP request.
     */
    public async suggestFoods(query: string): Promise<readonly SearchResultView[]> {
        const result = await this.foodClient.search(query.trim());

        return result.results;
    }

    /**
     * Add an unknown food by name. The food service returns `202` with a non-terminal status
     * (`PENDING` / `UNRESOLVED`); we persist a food-backed catalog row (deduped on the opaque `food_id`)
     * and return it immediately so the picker renders a "nutrition pending" state and polls later.
     *
     * @param name - The display name (trimmed here).
     * @returns The created (or deduped) food-backed ingredient with its current resolution status.
     * @sideEffect Calls the food service, then reads/writes `ingredients`.
     */
    public async addByName(name: string): Promise<Ingredient> {
        const trimmed = name.trim();
        const added = await this.foodClient.addByName(trimmed);
        const existing = await this.dal.findByFoodId(added.id);

        if (existing) {
            return existing;
        }

        return this.dal.createFoodBacked({
            name: trimmed,
            foodId: added.id,
            foodResolutionStatus: toResolutionStatus(added.status),
        });
    }

    /**
     * Poll and persist the current resolution status of a food-backed ingredient. On `RESOLVED` the
     * golden-record per-100g nutrition is written back; a terminal `NOT_FOUND` / `FAILED` is recorded as
     * the ingredient's status (never thrown — the picker surfaces it and offers a freeform fallback).
     *
     * @param id - The 001 ingredient id.
     * @returns The refreshed ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     * @sideEffect Calls the food service, then updates `ingredients`.
     */
    public async refreshStatus(id: string): Promise<Ingredient> {
        const ingredient = await this.requireIngredient(id);

        // Freeform / user-entered ingredients carry no food reference — nothing to poll.
        if (ingredient.foodId === undefined) {
            return ingredient;
        }

        try {
            const status = await this.foodClient.getStatus(ingredient.foodId);
            const nutrition =
                status.status === 'RESOLVED' && status.food !== undefined ? extractNutrition(status.food) : undefined;
            const updated = await this.dal.updateResolution(id, {
                foodResolutionStatus: toResolutionStatus(status.status),
                nutrition,
            });

            return updated ?? ingredient;
        } catch (error) {
            // A terminal food (NOT_FOUND / FAILED) or a vanished row surfaces as a client NotFoundError;
            // record the terminal status rather than propagating, so the picker can fall back to freeform.
            if (isNotFoundError(error)) {
                const terminal = toResolutionStatus(error.foodStatus ?? 'NOT_FOUND');
                const updated = await this.dal.updateResolution(id, { foodResolutionStatus: terminal });

                return updated ?? ingredient;
            }

            throw error;
        }
    }

    /**
     * The disambiguation candidate set for an `UNRESOLVED` food-backed ingredient.
     *
     * @param id - The 001 ingredient id.
     * @returns The (non-expired) candidate set; empty for a freeform or non-`UNRESOLVED` ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     * @sideEffect Calls the food service.
     */
    public async getCandidates(id: string): Promise<readonly CandidateView[]> {
        const ingredient = await this.requireIngredient(id);

        if (ingredient.foodId === undefined) {
            return [];
        }

        const result = await this.foodClient.getCandidates(ingredient.foodId);

        return result.candidates;
    }

    /**
     * Resolve an `UNRESOLVED` food-backed ingredient from a candidate pick, then re-poll so the newly
     * `RESOLVED` golden-record nutrition is persisted.
     *
     * @param id - The 001 ingredient id.
     * @param candidateIds - The picked candidate row ids (validated to the food's own set by the service).
     * @returns The refreshed, resolved ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     * @sideEffect Calls the food service (resolve + status), then updates `ingredients`.
     */
    public async resolve(id: string, candidateIds: readonly string[]): Promise<Ingredient> {
        const ingredient = await this.requireIngredient(id);

        if (ingredient.foodId === undefined) {
            return ingredient;
        }

        await this.foodClient.resolve(ingredient.foodId, candidateIds);

        return this.refreshStatus(id);
    }

    /**
     * Create (or dedup-return) a freeform, user-entered ingredient (`is_user_entered = true`) for the
     * `POST /v1/ingredients` fallback — a name with no linked food record. Its nutrition, when supplied,
     * lives per-line on `recipe_ingredients`, not here.
     *
     * @param name - The display name (trimmed here).
     * @returns The created or pre-existing freeform ingredient.
     * @sideEffect Reads, then conditionally inserts into `ingredients`.
     */
    public async createFreeform(name: string): Promise<Ingredient> {
        return this.dal.createFreeform(name.trim());
    }

    /** Load an ingredient or throw the domain `RECIPE_NOT_FOUND` error (mapped to 404 by the filter). */
    private async requireIngredient(id: string): Promise<Ingredient> {
        const ingredient = await this.dal.findById(id);

        if (ingredient === undefined) {
            const error: RecipeError = {
                code: RecipeErrorCode.RECIPE_NOT_FOUND,
                message: `Ingredient '${id}' not found`,
            };

            throw error;
        }

        return ingredient;
    }
}
