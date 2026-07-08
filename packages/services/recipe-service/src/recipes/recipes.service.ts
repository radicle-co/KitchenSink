/**
 * T025 / T033 — recipe CRUD orchestration + authorization.
 *
 * Sits between the controller (which supplies the authenticated owner key — `principal.userId`) and the
 * {@link RecipesDal}. It owns the domain rules the DAL deliberately does not:
 * - **Authorization** — mutations are owner-only (`owner_id == principal.userId` → else `NOT_OWNER`);
 *   a read is allowed for the owner OR any `public` recipe.
 * - **Optimistic concurrency (T033)** — an update whose `expectedVersion` != the stored
 *   `currentVersion` is rejected with `VERSION_CONFLICT` (409, `details.currentVersion`).
 * - **Response shaping** — persistence rows → the `Recipe` wire contract (ISO dates, `version`).
 *
 * Ownership is ALWAYS the app-user ULID, never the Clerk `sub` (D2 / REQ-IF-007).
 */
import { Inject, Injectable } from '@nestjs/common';

import { RecipesDal, type RecipeAggregate, type StepInput } from './dal/recipes.dal.js';
import { notOwner, recipeNotFound, versionConflict } from './recipe.error.js';
import type { CreateRecipeDto, RecipeIngredientInputDto } from './dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from './dto/update-recipe.dto.js';
import type { ListRecipesQueryDto } from './dto/list-recipes.query.dto.js';
import type { PaginatedRecipesResponse, RecipeResponse } from './dto/recipe-response.dto.js';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { RecipeRow } from '../database/schema/index.js';

/** DI token for the recipe DAL — provided by `RecipesModule` via `useFactory` over the Drizzle client. */
export const RECIPES_DAL = 'RECIPES_DAL';

/** Space-join ingredient display names into the denormalized, search-feeding text column. Pure. */
function buildIngredientNamesText(ingredients: RecipeIngredientInputDto[]): string {
    return ingredients
        .map((ingredient) => ingredient.name.trim())
        .filter((name) => name.length > 0)
        .join(' ');
}

/** Map a DTO step to the DAL's step input shape. Pure. */
function toStepInput(step: { instruction: string; timerSeconds?: number }): StepInput {
    return step.timerSeconds === undefined
        ? { instruction: step.instruction }
        : { instruction: step.instruction, timerSeconds: step.timerSeconds };
}

/** Map a persisted recipe aggregate to the `Recipe` wire contract. Pure. */
function toRecipeResponse(aggregate: RecipeAggregate): RecipeResponse {
    const { recipe, steps } = aggregate;

    return {
        id: recipe.id,
        ownerId: recipe.ownerId,
        title: recipe.title,
        ...(recipe.description !== null ? { description: recipe.description } : {}),
        ...(recipe.cuisine !== null ? { cuisine: recipe.cuisine } : {}),
        visibility: recipe.visibility as RecipeVisibility,
        // The relational ingredient rows are owned by the ingredients vertical; this vertical persists
        // only the denormalized `ingredient_names_text`, so the composed array is empty here.
        ingredients: [],
        steps: steps.map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        totalTimeMinutes: recipe.totalTimeMinutes,
        tags: recipe.tags,
        dietaryFlags: recipe.dietaryFlags,
        version: recipe.currentVersion,
        createdAt: recipe.createdAt.toISOString(),
        updatedAt: recipe.updatedAt.toISOString(),
        deletedAt: recipe.deletedAt !== null ? recipe.deletedAt.toISOString() : null,
    };
}

@Injectable()
export class RecipesService {
    public constructor(@Inject(RECIPES_DAL) private readonly dal: RecipesDal) {}

    /** Create a recipe owned by `ownerId`. */
    public async create(ownerId: string, dto: CreateRecipeDto): Promise<RecipeResponse> {
        const aggregate = await this.dal.create({
            ownerId,
            title: dto.title,
            description: dto.description,
            cuisine: dto.cuisine,
            visibility: dto.visibility ?? 'public',
            servings: dto.servings,
            prepTimeMinutes: dto.prepTimeMinutes,
            cookTimeMinutes: dto.cookTimeMinutes,
            totalTimeMinutes: dto.totalTimeMinutes,
            tags: dto.tags ?? [],
            dietaryFlags: dto.dietaryFlags ?? [],
            ingredientNamesText: buildIngredientNamesText(dto.ingredients),
            steps: dto.steps.map(toStepInput),
        });

        return toRecipeResponse(aggregate);
    }

    /** Fetch one recipe. Allowed for the owner, or for any `public` recipe. */
    public async getById(ownerId: string, id: string): Promise<RecipeResponse> {
        const aggregate = await this.dal.findById(id);

        if (!aggregate) {
            throw recipeNotFound(id);
        }

        if (aggregate.recipe.ownerId !== ownerId && aggregate.recipe.visibility !== 'public') {
            throw notOwner(id);
        }

        return toRecipeResponse(aggregate);
    }

    /** List the caller's own recipes (owner-scoped, tombstones excluded), paginated. */
    public async list(ownerId: string, query: ListRecipesQueryDto): Promise<PaginatedRecipesResponse> {
        const { page, pageSize, sortBy } = query;
        const { rows, total } = await this.dal.findAll({ ownerId, page, pageSize, sortBy });

        return {
            data: rows.map(toRecipeResponse),
            total,
            page,
            pageSize,
            hasMore: page * pageSize < total,
        };
    }

    /** Update a recipe the caller owns, enforcing optimistic concurrency (T033). */
    public async update(ownerId: string, id: string, dto: UpdateRecipeDto): Promise<RecipeResponse> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        if (existing.recipe.currentVersion !== dto.expectedVersion) {
            throw versionConflict(existing.recipe.currentVersion, dto.expectedVersion);
        }

        const updated = await this.dal.update(id, {
            title: dto.title,
            description: dto.description,
            cuisine: dto.cuisine,
            servings: dto.servings,
            prepTimeMinutes: dto.prepTimeMinutes,
            cookTimeMinutes: dto.cookTimeMinutes,
            totalTimeMinutes: dto.totalTimeMinutes,
            tags: dto.tags,
            dietaryFlags: dto.dietaryFlags,
            ...(dto.ingredients !== undefined
                ? { ingredientNamesText: buildIngredientNamesText(dto.ingredients) }
                : {}),
            ...(dto.steps !== undefined ? { steps: dto.steps.map(toStepInput) } : {}),
        });

        if (!updated) {
            // The active row vanished between the read and the write (a concurrent tombstone).
            throw recipeNotFound(id);
        }

        return toRecipeResponse(updated);
    }

    /** Soft-delete (tombstone) a recipe the caller owns. */
    public async delete(ownerId: string, id: string): Promise<void> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        const removed = await this.dal.softDelete(id);

        if (!removed) {
            throw recipeNotFound(id);
        }
    }

    /** Owner-only guard for mutations: `owner_id == principal.userId` or `NOT_OWNER`. */
    private assertOwner(ownerId: string, recipe: RecipeRow): void {
        if (recipe.ownerId !== ownerId) {
            throw notOwner(recipe.id);
        }
    }
}
