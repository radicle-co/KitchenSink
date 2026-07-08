/**
 * T024 — the recipe data-access layer.
 *
 * Owns every SQL touch of the golden `recipes` row and its ordered `recipe_steps` (both defined in
 * `database/schema/recipes.ts`). It is authorization-agnostic: it filters `findAll` by `ownerId` and
 * always excludes tombstoned rows (`deleted_at IS NULL`), but the NOT_OWNER / VERSION_CONFLICT
 * decisions live in `RecipesService`. Create and version-bumping updates run in a transaction so the
 * recipe row and its steps stay consistent.
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeSteps, recipes, type RecipeRow, type RecipeStepRow } from '../../database/schema/index.js';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { RecipeListSortBy } from '../dto/list-recipes.query.dto.js';

/** A single instruction line to persist (the DAL assigns 1-based `stepNumber` from array order). */
export interface StepInput {
    instruction: string;
    timerSeconds?: number;
}

/** Everything the DAL needs to insert a new golden recipe row + its steps. */
export interface CreateRecipeInput {
    ownerId: string;
    title: string;
    description?: string;
    cuisine?: string;
    visibility: RecipeVisibility;
    servings: number;
    prepTimeMinutes: number;
    cookTimeMinutes: number;
    totalTimeMinutes: number;
    tags: string[];
    dietaryFlags: string[];
    /** Denormalized, space-joined ingredient names — the recipe-owned column that feeds search. */
    ingredientNamesText: string;
    steps: StepInput[];
}

/** A partial content update. When `steps` is present the DAL replaces the full step list. */
export interface UpdateRecipeInput {
    title?: string;
    description?: string;
    cuisine?: string;
    servings?: number;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    totalTimeMinutes?: number;
    tags?: string[];
    dietaryFlags?: string[];
    ingredientNamesText?: string;
    steps?: StepInput[];
}

/** The golden recipe row bundled with its ordered steps — the DAL's return unit. */
export interface RecipeAggregate {
    recipe: RecipeRow;
    steps: RecipeStepRow[];
}

/** Pagination + sort inputs for {@link RecipesDal.findAll}. */
export interface FindAllOptions {
    ownerId: string;
    page: number;
    pageSize: number;
    sortBy: RecipeListSortBy;
}

/** A page of aggregates plus the unpaginated total (for `hasMore` computation upstream). */
export interface FindAllResult {
    rows: RecipeAggregate[];
    total: number;
}

/** A minimal writer surface satisfied by both the Drizzle client and a transaction handle. */
type Writer = Pick<RecipeDrizzle, 'insert' | 'select' | 'update' | 'delete'>;

/** Build the `recipe_steps` insert rows, assigning 1-based `stepNumber` from array order. Pure. */
function toStepRows(
    recipeId: string,
    steps: StepInput[],
): { recipeId: string; stepNumber: number; instruction: string; timerSeconds: number | null }[] {
    return steps.map((step, index) => ({
        recipeId,
        stepNumber: index + 1,
        instruction: step.instruction,
        timerSeconds: step.timerSeconds ?? null,
    }));
}

export class RecipesDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Insert a golden recipe row and its ordered steps in one transaction.
     *
     * @sideEffect Inserts one `recipes` row and 0..n `recipe_steps` rows.
     */
    public async create(input: CreateRecipeInput): Promise<RecipeAggregate> {
        return this.db.transaction(async (tx) => {
            const [recipe] = await tx
                .insert(recipes)
                .values({
                    ownerId: input.ownerId,
                    title: input.title,
                    description: input.description ?? null,
                    cuisine: input.cuisine ?? null,
                    visibility: input.visibility,
                    servings: input.servings,
                    prepTimeMinutes: input.prepTimeMinutes,
                    cookTimeMinutes: input.cookTimeMinutes,
                    totalTimeMinutes: input.totalTimeMinutes,
                    tags: input.tags,
                    dietaryFlags: input.dietaryFlags,
                    ingredientNamesText: input.ingredientNamesText,
                })
                .returning();

            if (!recipe) {
                throw new Error('RecipesDal.create: insert returned no recipe row');
            }

            const steps = await this.insertSteps(tx, recipe.id, input.steps);

            return { recipe, steps };
        });
    }

    /**
     * Load one active (non-tombstoned) recipe + its steps.
     *
     * @returns The aggregate, or `undefined` when no active recipe has that id.
     * @sideEffect Reads `recipes` and `recipe_steps`.
     */
    public async findById(id: string): Promise<RecipeAggregate | undefined> {
        const [recipe] = await this.db
            .select()
            .from(recipes)
            .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
            .limit(1);

        if (!recipe) {
            return undefined;
        }

        const steps = await this.loadSteps(this.db, [recipe.id]);

        return { recipe, steps };
    }

    /**
     * List one owner's active recipes, newest-first by default, with pagination.
     *
     * @sideEffect Reads `recipes` (page + count) and `recipe_steps` for the page.
     */
    public async findAll(options: FindAllOptions): Promise<FindAllResult> {
        const { ownerId, page, pageSize, sortBy } = options;
        const where = and(eq(recipes.ownerId, ownerId), isNull(recipes.deletedAt));
        const offset = (page - 1) * pageSize;

        const orderBy =
            sortBy === 'title'
                ? asc(recipes.title)
                : sortBy === 'createdAt'
                  ? desc(recipes.createdAt)
                  : desc(recipes.updatedAt);

        const pageRows = await this.db
            .select()
            .from(recipes)
            .where(where)
            .orderBy(orderBy)
            .limit(pageSize)
            .offset(offset);

        const countRows = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(recipes)
            .where(where);
        const total = countRows[0]?.count ?? 0;

        const ids = pageRows.map((row) => row.id);
        const steps = ids.length > 0 ? await this.loadSteps(this.db, ids) : [];
        const byRecipe = groupSteps(steps);

        return {
            rows: pageRows.map((recipe) => ({ recipe, steps: byRecipe.get(recipe.id) ?? [] })),
            total,
        };
    }

    /**
     * Apply a partial content update to an active recipe, bumping `current_version` by one. When
     * `input.steps` is present the entire step list is replaced.
     *
     * @returns The updated aggregate, or `undefined` when no active recipe has that id.
     * @sideEffect Updates the `recipes` row and (optionally) rewrites `recipe_steps`.
     */
    public async update(id: string, input: UpdateRecipeInput): Promise<RecipeAggregate | undefined> {
        return this.db.transaction(async (tx) => {
            const [recipe] = await tx
                .update(recipes)
                .set({
                    ...(input.title !== undefined ? { title: input.title } : {}),
                    ...(input.description !== undefined ? { description: input.description } : {}),
                    ...(input.cuisine !== undefined ? { cuisine: input.cuisine } : {}),
                    ...(input.servings !== undefined ? { servings: input.servings } : {}),
                    ...(input.prepTimeMinutes !== undefined ? { prepTimeMinutes: input.prepTimeMinutes } : {}),
                    ...(input.cookTimeMinutes !== undefined ? { cookTimeMinutes: input.cookTimeMinutes } : {}),
                    ...(input.totalTimeMinutes !== undefined ? { totalTimeMinutes: input.totalTimeMinutes } : {}),
                    ...(input.tags !== undefined ? { tags: input.tags } : {}),
                    ...(input.dietaryFlags !== undefined ? { dietaryFlags: input.dietaryFlags } : {}),
                    ...(input.ingredientNamesText !== undefined
                        ? { ingredientNamesText: input.ingredientNamesText }
                        : {}),
                    currentVersion: sql`${recipes.currentVersion} + 1`,
                    updatedAt: new Date(),
                })
                .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
                .returning();

            if (!recipe) {
                return undefined;
            }

            let steps: RecipeStepRow[];

            if (input.steps !== undefined) {
                await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, id));
                steps = await this.insertSteps(tx, id, input.steps);
            } else {
                steps = await this.loadSteps(tx, [id]);
            }

            return { recipe, steps };
        });
    }

    /**
     * Soft-delete (tombstone) an active recipe by setting `deleted_at`.
     *
     * @returns `true` when an active row was tombstoned, `false` when none matched (already gone).
     * @sideEffect Sets `deleted_at` on the `recipes` row.
     */
    public async softDelete(id: string): Promise<boolean> {
        const now = new Date();
        const deleted = await this.db
            .update(recipes)
            .set({ deletedAt: now, updatedAt: now })
            .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
            .returning({ id: recipes.id });

        return deleted.length > 0;
    }

    /** Insert step rows for a recipe and return them ordered. */
    private async insertSteps(writer: Writer, recipeId: string, steps: StepInput[]): Promise<RecipeStepRow[]> {
        if (steps.length === 0) {
            return [];
        }

        return writer.insert(recipeSteps).values(toStepRows(recipeId, steps)).returning();
    }

    /** Load steps for one or more recipes, ordered by recipe then step number. */
    private async loadSteps(reader: Pick<RecipeDrizzle, 'select'>, recipeIds: string[]): Promise<RecipeStepRow[]> {
        return reader
            .select()
            .from(recipeSteps)
            .where(inArray(recipeSteps.recipeId, recipeIds))
            .orderBy(asc(recipeSteps.recipeId), asc(recipeSteps.stepNumber));
    }
}

/** Group step rows by their `recipeId`. Pure. */
function groupSteps(steps: RecipeStepRow[]): Map<string, RecipeStepRow[]> {
    const byRecipe = new Map<string, RecipeStepRow[]>();

    for (const step of steps) {
        const bucket = byRecipe.get(step.recipeId);

        if (bucket) {
            bucket.push(step);
        } else {
            byRecipe.set(step.recipeId, [step]);
        }
    }

    return byRecipe;
}
