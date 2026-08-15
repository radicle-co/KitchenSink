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
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import {
    recipeSteps,
    recipeVersions,
    recipes,
    type RecipeIngredientRow,
    type RecipeRow,
    type RecipeStepRow,
    type RecipeVersionRow,
} from '../../database/schema/index.js';
import { type Writer } from '../../database/unitOfWork.js';
import type { RecipeDifficulty, RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import type { RecipeListSortBy } from '../dto/listRecipes.query.dto.js';
import { activeRecipe } from './recipePredicates.js';
import { RecipeIngredientsDal, type ResolvedIngredientLine } from './recipeIngredients.dal.js';

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
    /**
     * Author-stated difficulty (FR-001b). OMITTED (undefined) when the author states none — the column is
     * nullable with no default, so an unstated difficulty stays NULL. There is no `null` on create (the
     * clear sentinel is an update-only concern); either a value is set or the field is left off entirely.
     */
    difficulty?: RecipeDifficulty;
    /**
     * Publication status (W8-a.3). OMITTED → the column defaults to `published` (a normal create publishes);
     * the wizard's Save-Draft passes `draft`. A clone omits it (a clone is a new published recipe).
     */
    status?: RecipeStatus;
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
    /**
     * The author's denormalized display name (W8-a.2) — the initial value from `deriveDisplayName(claims)`
     * (or the `author_handles` read model). OMITTED when nothing is derivable; the handle-sync fan-out /
     * backfill fills it later. Kept current thereafter by the consumer.
     */
    authorHandle?: string;
    /**
     * Denormalized headline per-serving calories (W8-a.1), recomputed by the service from the resolved
     * lines. OMITTED when the recipe has no accounted nutrition, so the column stays NULL (the projection
     * then omits the field — never a misleading 0). No `null` on create (clearing is an update-only concern).
     */
    leadCaloriesPerServing?: number;
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
    /**
     * Author-stated difficulty (FR-001b) — the three-state update field. `undefined` (absent) leaves the
     * stored value UNCHANGED; a value SETS it; explicit `null` CLEARS it back to "not stated" (the column
     * is nullable, no default). The DAL keys off `!== undefined` so `null` is written through as a real
     * clear — treating `null` as "absent" would make a set difficulty unclearable, which FR-001b forbids.
     */
    difficulty?: RecipeDifficulty | null;
    /**
     * Publication status (W8-a.3). `undefined` (absent) leaves it UNCHANGED; a value SETS it (`published` =
     * the Publish action, `draft` = re-draft). Two-state (never `null` — status is NOT NULL).
     */
    status?: RecipeStatus;
    tags?: string[];
    dietaryFlags?: string[];
    ingredientNamesText?: string;
    /**
     * Denormalized headline per-serving calories (W8-a.1). `undefined` (absent) leaves the stored value
     * UNCHANGED; a number SETS it; explicit `null` CLEARS it to NULL (the recipe lost all accounted
     * nutrition). The service recomputes and passes this only when an input (lines/servings) changed.
     */
    leadCaloriesPerServing?: number | null;
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

/**
 * A list-page aggregate: a {@link RecipeAggregate} plus the resolved cover-photo object key (CR-001 /
 * FR-001c). The key is resolved for the whole page in ONE cover LATERAL (no N+1); the service maps it to
 * an absolute CDN URL. ABSENT when the recipe has no photos.
 */
export interface ListRecipeAggregate extends RecipeAggregate {
    coverPhotoKey?: string;
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
    rows: ListRecipeAggregate[];
    total: number;
}

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
                    // Difficulty is set only when the author stated one; omitted otherwise so the column
                    // stays NULL ("not stated"). No default is ever fabricated (FR-001b).
                    ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
                    // Publication status (W8-a.3) — omitted → the column defaults to 'published'.
                    ...(input.status !== undefined ? { status: input.status } : {}),
                    tags: input.tags,
                    dietaryFlags: input.dietaryFlags,
                    ingredientNamesText: input.ingredientNamesText,
                    // Denormalized author handle (W8-a.2) — omitted → NULL until the fan-out/backfill fills it.
                    ...(input.authorHandle !== undefined ? { authorHandle: input.authorHandle } : {}),
                    // Denormalized lead calories (W8-a.1) — the `numeric` column takes a string; omitted when
                    // absent so it defaults NULL (recipe has no accounted nutrition).
                    ...(input.leadCaloriesPerServing !== undefined
                        ? { leadCaloriesPerServing: input.leadCaloriesPerServing.toString() }
                        : {}),
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
            .where(and(eq(recipes.id, id), activeRecipe()))
            .limit(1);

        if (!recipe) {
            return undefined;
        }

        const steps = await this.loadSteps(this.db, [recipe.id]);
        const ingredients = await this.linkDal.loadByRecipeIds(this.db, [recipe.id]);

        return { recipe, steps, ingredients };
    }

    /**
     * Read the material for an enriched `409 VERSION_CONFLICT` (W8-a.5) in ONE REPEATABLE READ transaction,
     * so the current server aggregate and the two version rows are read from a single coherent snapshot — a
     * third concurrent writer cannot make the returned `server` a version ahead of the `currentVersion` this
     * reports. Returns the current aggregate plus the `recipe_versions` rows for the client's `expectedVersion`
     * (the conflict base — absent when evicted past the DB retention window) and the current version (whose
     * `device_label` labels the server side).
     *
     * @returns The conflict material, or `undefined` when the recipe is missing/tombstoned (→ a 404, not a 409).
     * @sideEffect Read-only (reads `recipes`, `recipe_steps`, `recipe_ingredients`, `recipe_versions`).
     */
    public async readConflict(
        id: string,
        expectedVersion: number,
    ): Promise<
        { current: RecipeAggregate; baseVersion?: RecipeVersionRow; serverVersion?: RecipeVersionRow } | undefined
    > {
        return this.db.transaction(async (tx) => {
            await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);

            const [recipe] = await tx
                .select()
                .from(recipes)
                .where(and(eq(recipes.id, id), activeRecipe()))
                .limit(1);

            if (!recipe) {
                return undefined;
            }

            const steps = await this.loadSteps(tx, [recipe.id]);
            const ingredients = await this.linkDal.loadByRecipeIds(tx, [recipe.id]);

            const versionRows = await tx
                .select()
                .from(recipeVersions)
                .where(
                    and(
                        eq(recipeVersions.recipeId, id),
                        inArray(recipeVersions.versionNumber, [expectedVersion, recipe.currentVersion]),
                    ),
                );

            const baseVersion = versionRows.find((row) => row.versionNumber === expectedVersion);
            const serverVersion = versionRows.find((row) => row.versionNumber === recipe.currentVersion);

            return {
                current: { recipe, steps, ingredients },
                ...(baseVersion !== undefined ? { baseVersion } : {}),
                ...(serverVersion !== undefined ? { serverVersion } : {}),
            };
        });
    }

    /**
     * List one owner's active recipes, newest-first by default, with pagination.
     *
     * @sideEffect Reads `recipes` (page + count) and `recipe_steps` for the page.
     */
    public async findAll(options: FindAllOptions): Promise<FindAllResult> {
        const { ownerId, page, pageSize, sortBy } = options;
        const where = and(eq(recipes.ownerId, ownerId), activeRecipe());
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
        const coverKeys = ids.length > 0 ? await this.loadCoverKeys(ids) : new Map<string, string>();

        return {
            rows: pageRows.map((recipe) => {
                const coverPhotoKey = coverKeys.get(recipe.id);

                return {
                    recipe,
                    steps: byRecipe.get(recipe.id) ?? [],
                    ingredients: ingredientsByRecipe.get(recipe.id) ?? [],
                    ...(coverPhotoKey !== undefined ? { coverPhotoKey } : {}),
                };
            }),
            total,
        };
    }

    /**
     * Resolve the cover object key for a page of recipes in ONE query (CR-001 / FR-001c). The cover photo
     * is the one with the lowest `sort_order`; because `sort_order` is not unique, the tiebreak
     * (`created_at`, then the `id` PK) is part of the rule, so the same recipe yields the same cover across
     * requests. The KEY returned is the small thumbnail rendition when the cover photo has one, else its
     * full-size original (`COALESCE(thumbnail_key, s3_key)` — FOLLOW-UP-CR-001-A), so a card tile no longer
     * ships the up-to-5 MB original. A `LEFT JOIN LATERAL … LIMIT 1` per row avoids the N+1 a per-card
     * detail fetch would incur and uses `idx_recipe_photos_recipe_cover`. Recipes with no photos are simply
     * absent from the map.
     *
     * @sideEffect Reads `recipe_photos`.
     */
    private async loadCoverKeys(recipeIds: string[]): Promise<Map<string, string>> {
        const idList = sql.join(
            recipeIds.map((id) => sql`${id}`),
            sql`, `,
        );
        const result = await this.db.execute<{ id: string; cover_key: string | null }>(sql`
            SELECT r.id, cp.cover_key
            FROM recipes r
            LEFT JOIN LATERAL (
                -- Serve the small thumbnail rendition when present, else the full-size original
                -- (FOLLOW-UP-CR-001-A). Pre-thumbnail rows have thumbnail_key NULL → fall back to s3_key.
                SELECT COALESCE(p.thumbnail_key, p.s3_key) AS cover_key
                FROM recipe_photos p
                WHERE p.recipe_id = r.id
                ORDER BY p.sort_order, p.created_at, p.id
                LIMIT 1
            ) cp ON true
            WHERE r.id IN (${idList})
        `);

        const covers = new Map<string, string>();

        for (const row of result.rows) {
            if (row.cover_key !== null) {
                covers.set(row.id, row.cover_key);
            }
        }

        return covers;
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
                    // Three-state difficulty (FR-001b): absent → key omitted (unchanged); a value → set;
                    // explicit `null` → written as NULL (cleared). The `!== undefined` guard is what keeps
                    // "clear" (null) distinct from "leave unchanged" (absent) — do not collapse them.
                    ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
                    // Publication status (W8-a.3) — absent leaves it unchanged; a value sets it (publish/re-draft).
                    ...(input.status !== undefined ? { status: input.status } : {}),
                    ...(input.tags !== undefined ? { tags: input.tags } : {}),
                    ...(input.dietaryFlags !== undefined ? { dietaryFlags: input.dietaryFlags } : {}),
                    ...(input.ingredientNamesText !== undefined
                        ? { ingredientNamesText: input.ingredientNamesText }
                        : {}),
                    // Denormalized lead calories (W8-a.1), three-state like difficulty: absent → unchanged;
                    // a number → set (numeric column takes a string); explicit `null` → cleared to NULL when
                    // the recipe lost all accounted nutrition. `!== undefined` keeps clear distinct from unchanged.
                    ...(input.leadCaloriesPerServing !== undefined
                        ? {
                              leadCaloriesPerServing:
                                  input.leadCaloriesPerServing === null
                                      ? null
                                      : input.leadCaloriesPerServing.toString(),
                          }
                        : {}),
                    ...(input.hasSubstantiveEdit !== undefined ? { hasSubstantiveEdit: input.hasSubstantiveEdit } : {}),
                    currentVersion: sql`${recipes.currentVersion} + 1`,
                    updatedAt: new Date(),
                })
                // Atomic compare-and-swap on the version: the row advances ONLY if it is still at
                // `expectedVersion`. A concurrent update that already bumped it makes this match 0 rows,
                // which the service turns into VERSION_CONFLICT — closing the lost-update race a separate
                // read-then-check leaves open.
                .where(and(eq(recipes.id, id), activeRecipe(), eq(recipes.currentVersion, input.expectedVersion)))
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
            .where(and(eq(recipes.id, id), activeRecipe()))
            .returning({ id: recipes.id });

        return deleted.length > 0;
    }

    /**
     * Set an active recipe's visibility WITHOUT bumping `current_version` or touching content — a
     * visibility toggle is a metadata change, not a content revision (C-004 / T050). Authorization and
     * the C-004 policy decision live in `RecipesService`.
     *
     * @returns The updated aggregate, or `undefined` when no active recipe has that id.
     * @sideEffect Updates the `recipes` row's `visibility` + `updated_at`.
     */
    public async setVisibility(id: string, visibility: RecipeVisibility): Promise<RecipeAggregate | undefined> {
        const [recipe] = await this.db
            .update(recipes)
            .set({ visibility, updatedAt: new Date() })
            .where(and(eq(recipes.id, id), activeRecipe()))
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
