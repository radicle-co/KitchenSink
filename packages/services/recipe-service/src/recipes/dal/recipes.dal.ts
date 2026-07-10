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
import {
    recipeSteps,
    recipes,
    type RecipeIngredientRow,
    type RecipeRow,
    type RecipeStepRow,
} from '../../database/schema/index.js';
import type { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';
import type { RecipeListSortBy } from '../dto/list-recipes.query.dto.js';
import { RecipeIngredientsDal, type ResolvedIngredientLine } from './recipe-ingredients.dal.js';

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
    // servings + times are REQUIRED (contract #4/#6: NOT NULL) — every recipe has a serving amount and
    // prep/cook/total time (total is independent, not derived — inactive rest/marinate time counts).
    servings: number;
    prepTimeMinutes: number;
    cookTimeMinutes: number;
    totalTimeMinutes: number;
    tags: string[];
    dietaryFlags: string[];
    // ── Provenance (C-004) — omitted on a plain create (DB defaults apply); set when cloning. ──
    /** Recipe provenance classification (defaults to `user_created` when omitted). */
    sourceType?: RecipeSourceType;
    /** Original source URL (imported/cloned recipes), or `null`. */
    sourceUrl?: string | null;
    /** Human-readable attribution string (imported/cloned recipes), or `null`. */
    sourceAttribution?: string | null;
    /** The source recipe id when this row is a clone (FR-011). */
    clonedFromId?: string | null;
    /** Whether the recipe already carries a substantive edit (a clone resets this to `false`). */
    hasSubstantiveEdit?: boolean;
    /** Denormalized, space-joined ingredient names — the recipe-owned column that feeds search. */
    ingredientNamesText: string;
    /** Resolved `recipe_ingredients` link rows, persisted in the same transaction as the recipe. */
    ingredients: ResolvedIngredientLine[];
    steps: StepInput[];
}

/** A partial content update. When `steps`/`ingredients` are present the DAL replaces that full list. */
export interface UpdateRecipeInput {
    /**
     * The version the caller based this edit on. The DAL folds it into the UPDATE's WHERE as an ATOMIC
     * compare-and-swap (`current_version = expectedVersion`), so two concurrent updates from the same base
     * cannot both win — the loser matches 0 rows and the service raises `VERSION_CONFLICT` (T033). A
     * service-layer read-then-check is NOT sufficient: under READ COMMITTED both requests read the same
     * version, both pass the check, and the row lock merely serializes the writes → a silent lost update.
     */
    expectedVersion: number;
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
    /**
     * Flip the substantive-edit flag (C-004 / FR-005). The service sets this to `true` on a
     * content (ingredients/steps) change; it is monotonic (never reset to `false` on update).
     */
    hasSubstantiveEdit?: boolean;
    /** When present, the entire ingredient link set is replaced; when absent, links are left untouched. */
    ingredients?: ResolvedIngredientLine[];
    steps?: StepInput[];
}

/** The golden recipe row bundled with its ordered steps + ingredient links — the DAL's return unit. */
export interface RecipeAggregate {
    recipe: RecipeRow;
    steps: RecipeStepRow[];
    ingredients: RecipeIngredientRow[];
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
    /** Owns the `recipe_ingredients` junction; driven inside this DAL's transactions for atomicity. */
    private readonly linkDal = new RecipeIngredientsDal();

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
                    // Provenance is only present when cloning; omit otherwise so the column defaults apply.
                    ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
                    ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
                    ...(input.sourceAttribution !== undefined ? { sourceAttribution: input.sourceAttribution } : {}),
                    ...(input.clonedFromId !== undefined ? { clonedFromId: input.clonedFromId } : {}),
                    ...(input.hasSubstantiveEdit !== undefined ? { hasSubstantiveEdit: input.hasSubstantiveEdit } : {}),
                })
                .returning();

            if (!recipe) {
                throw new Error('RecipesDal.create: insert returned no recipe row');
            }

            const steps = await this.insertSteps(tx, recipe.id, input.steps);
            const ingredients = await this.linkDal.replaceForRecipe(tx, recipe.id, input.ingredients);

            return { recipe, steps, ingredients };
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
        const ingredients = await this.linkDal.loadByRecipeIds(this.db, [recipe.id]);

        return { recipe, steps, ingredients };
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
        const ingredientRows = ids.length > 0 ? await this.linkDal.loadByRecipeIds(this.db, ids) : [];
        const ingredientsByRecipe = groupIngredients(ingredientRows);

        return {
            rows: pageRows.map((recipe) => ({
                recipe,
                steps: byRecipe.get(recipe.id) ?? [],
                ingredients: ingredientsByRecipe.get(recipe.id) ?? [],
            })),
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
                    ...(input.hasSubstantiveEdit !== undefined ? { hasSubstantiveEdit: input.hasSubstantiveEdit } : {}),
                    currentVersion: sql`${recipes.currentVersion} + 1`,
                    updatedAt: new Date(),
                })
                // Atomic compare-and-swap on the version: the row advances ONLY if it is still at
                // `expectedVersion`. A concurrent update that already bumped it makes this match 0 rows,
                // which the service turns into VERSION_CONFLICT — closing the lost-update race a separate
                // read-then-check leaves open.
                .where(
                    and(
                        eq(recipes.id, id),
                        isNull(recipes.deletedAt),
                        eq(recipes.currentVersion, input.expectedVersion),
                    ),
                )
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

            // Replace the whole ingredient link set when the patch carries `ingredients`; otherwise leave
            // the existing links untouched and return them as-is.
            const ingredients =
                input.ingredients !== undefined
                    ? await this.linkDal.replaceForRecipe(tx, id, input.ingredients)
                    : await this.linkDal.loadByRecipeIds(tx, [id]);

            return { recipe, steps, ingredients };
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

    /**
     * Set an active recipe's visibility WITHOUT bumping `current_version` or touching content — a
     * visibility toggle is a metadata change, not a content revision (C-004 / T050). Authorization and
     * the C-004 policy decision live in {@link RecipesService}.
     *
     * @returns The updated aggregate, or `undefined` when no active recipe has that id.
     * @sideEffect Updates the `recipes` row's `visibility` + `updated_at`.
     */
    public async setVisibility(id: string, visibility: RecipeVisibility): Promise<RecipeAggregate | undefined> {
        const [recipe] = await this.db
            .update(recipes)
            .set({ visibility, updatedAt: new Date() })
            .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
            .returning();

        if (!recipe) {
            return undefined;
        }

        const steps = await this.loadSteps(this.db, [recipe.id]);
        const ingredients = await this.linkDal.loadByRecipeIds(this.db, [recipe.id]);

        return { recipe, steps, ingredients };
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

/** Group ingredient link rows by their `recipeId` (input already ordered by `sortOrder`). Pure. */
function groupIngredients(rows: RecipeIngredientRow[]): Map<string, RecipeIngredientRow[]> {
    const byRecipe = new Map<string, RecipeIngredientRow[]>();

    for (const row of rows) {
        const bucket = byRecipe.get(row.recipeId);

        if (bucket) {
            bucket.push(row);
        } else {
            byRecipe.set(row.recipeId, [row]);
        }
    }

    return byRecipe;
}
