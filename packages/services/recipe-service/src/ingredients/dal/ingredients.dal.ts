/**
 * T027 — `IngredientsDal`: the data-access layer for the 001-owned `ingredients` catalog.
 *
 * Owns three responsibilities (data-model.md `ingredients` section):
 *   1. **Fuzzy + full-text search** — a single ranked read combining the `pg_trgm` GIN index
 *      (`idx_ingredients_name_trgm`, typo/substring tolerant) with the tsvector FTS index
 *      (`idx_ingredients_search_vector`). Score is `GREATEST(ts_rank, similarity(name))` so a strong
 *      lexeme match OR a strong fuzzy/typo match both rank a row up; ties break on name.
 *   2. **Creation** — freeform (user-entered) rows (`is_user_entered = true`, no `food_id`) and
 *      food-service-backed rows (`food_id` + `food_resolution_status`, `is_user_entered = false`).
 *      There is **no** DB trigger maintaining `ingredients.search_vector` (unlike `recipes`), so the DAL
 *      populates it on write via `to_tsvector('english', name)`.
 *   3. **Dedup** — a food-backed insert dedups on the opaque `food_id`; a freeform insert dedups on a
 *      case-insensitive `name` match against an existing freeform row — so the shared catalog does not
 *      bloat with duplicates.
 *
 * The `ingredients` table is a **shared catalog** with no `owner_id` (per-user, per-recipe overrides
 * live on `recipe_ingredients`), so no ownership predicate is applied here. Rows are returned already
 * mapped to the canonical `@kitchensink/recipe-core` `Ingredient` domain shape (numeric strings →
 * numbers, `null` → `undefined`, `created_at` → ISO-8601), never leaking the raw `search_vector`.
 *
 * @implements FR-007 FR-007a
 */
import { sql } from 'drizzle-orm';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient, IngredientPortion } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/database.module.js';

/** Default number of search hits returned when the caller does not specify a limit. */
export const DEFAULT_SEARCH_LIMIT = 10;

/** Hard ceiling on search hits (mirrors the OpenAPI `limit` maximum). */
export const MAX_SEARCH_LIMIT = 50;

/** The explicit column projection returned by every DAL read/write (never the `search_vector`). */
const RETURNING = sql`id, name, food_id, food_resolution_status, is_user_entered,
    calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, portions, created_at`;

/** Nutrition-per-100g overrides applied when a food resolves to its golden record. */
export interface IngredientNutrition {
    /** Calories per 100g. */
    readonly caloriesPer100g?: number;
    /** Protein grams per 100g. */
    readonly proteinGPer100g?: number;
    /** Carbohydrate grams per 100g. */
    readonly carbsGPer100g?: number;
    /** Fat grams per 100g. */
    readonly fatGPer100g?: number;
}

/** Input to {@link IngredientsDal.createFoodBacked}. */
export interface CreateFoodBackedInput {
    /** Display name of the ingredient. */
    readonly name: string;
    /** Opaque food-service internal id (ULID) backing this ingredient. */
    readonly foodId: string;
    /** The async resolution status returned by the food service. */
    readonly foodResolutionStatus: FoodResolutionStatus;
}

/** Input to {@link IngredientsDal.updateResolution}. */
export interface UpdateResolutionInput {
    /** The new resolution status. */
    readonly foodResolutionStatus: FoodResolutionStatus;
    /** Golden-record nutrition to persist (only when `RESOLVED`); omitted values are left untouched. */
    readonly nutrition?: IngredientNutrition;
    /** Household-measure portions to persist (only when `RESOLVED`); omitted leaves the column untouched. */
    readonly portions?: IngredientPortion[];
}

/**
 * The raw (snake_case) row shape returned by a `db.execute` over the `ingredients` projection. The
 * index signature satisfies Drizzle's `execute<T extends Record<string, unknown>>` constraint while the
 * named fields keep {@link rowToIngredient} fully typed.
 */
interface RawIngredientRow {
    [column: string]: unknown;
    id: string;
    name: string;
    food_id: string | null;
    food_resolution_status: string | null;
    is_user_entered: boolean;
    calories_per_100g: string | null;
    protein_g_per_100g: string | null;
    carbs_g_per_100g: string | null;
    fat_g_per_100g: string | null;
    // `jsonb` — the pg driver already parses it into JS (an array of portions), or null.
    portions: IngredientPortion[] | null;
    created_at: Date | string;
}

/** Convert a nullable numeric column (pg returns `numeric` as a string) to a number or `undefined`. */
function numberOrUndefined(value: string | null): number | undefined {
    return value === null ? undefined : Number(value);
}

/** Normalize a `timestamptz` (a `Date` from pg, or an ISO string in tests) to an ISO-8601 string. */
function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Map a raw `ingredients` row to the canonical `Ingredient` domain shape. Pure. */
export function rowToIngredient(row: RawIngredientRow): Ingredient {
    return {
        id: row.id,
        name: row.name,
        foodId: row.food_id ?? undefined,
        foodResolutionStatus:
            row.food_resolution_status === null ? undefined : (row.food_resolution_status as FoodResolutionStatus),
        isUserEntered: row.is_user_entered,
        caloriesPer100g: numberOrUndefined(row.calories_per_100g),
        proteinGPer100g: numberOrUndefined(row.protein_g_per_100g),
        carbsGPer100g: numberOrUndefined(row.carbs_g_per_100g),
        fatGPer100g: numberOrUndefined(row.fat_g_per_100g),
        // Only surface portions when present + non-empty (a resolved food with usable household measures).
        ...(Array.isArray(row.portions) && row.portions.length > 0 ? { portions: row.portions } : {}),
        createdAt: toIsoString(row.created_at),
    };
}

/** Clamp a requested search limit into `[1, MAX_SEARCH_LIMIT]`, defaulting when absent/invalid. Pure. */
export function clampLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return DEFAULT_SEARCH_LIMIT;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

export class IngredientsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Ranked fuzzy + full-text search over the shared ingredient catalog. A row matches when EITHER the
     * tsvector FTS path hits (`search_vector @@ plainto_tsquery`, word-order-independent) OR the
     * `pg_trgm` fuzzy fallback hits (`query <% name` word-similarity, or a substring `ILIKE`). Word
     * similarity (not full-string `similarity`/`%`) is used so a short typo query still matches a long
     * multi-word name — e.g. `'flor'` vs `'All-purpose flour'` scores 0.60 by word similarity but only
     * 0.15 full-string, which would fall below the 0.3 `%` threshold. Ranked by
     * `GREATEST(ts_rank, word_similarity(query, name))` so both strong lexeme relevance and strong typo
     * tolerance float a row up; ties break on name.
     *
     * @param query - The (already trimmed) user query. An empty query returns no rows.
     * @param limit - Max hits (clamped to `[1, MAX_SEARCH_LIMIT]`; defaults to `DEFAULT_SEARCH_LIMIT`).
     * @returns Ranked ingredient hits, or an empty array when nothing matches.
     * @sideEffect Reads `ingredients`.
     */
    public async search(query: string, limit?: number): Promise<Ingredient[]> {
        if (query.length === 0) {
            return [];
        }

        const pattern = `%${query}%`;
        const result = await this.db.execute<RawIngredientRow>(sql`
            SELECT ${RETURNING}
            FROM ingredients
            WHERE search_vector @@ plainto_tsquery('english', ${query})
               OR ${query} <% name
               OR name ILIKE ${pattern}
            ORDER BY GREATEST(
                         ts_rank(search_vector, plainto_tsquery('english', ${query})),
                         word_similarity(${query}, name)
                     ) DESC,
                     name ASC
            LIMIT ${clampLimit(limit)}
        `);

        return result.rows.map(rowToIngredient);
    }

    /**
     * Look up a single ingredient by its 001 catalog id.
     *
     * @param id - The `ingredients.id`.
     * @returns The ingredient, or `undefined` when no row exists.
     * @sideEffect Reads `ingredients`.
     */
    public async findById(id: string): Promise<Ingredient | undefined> {
        const result = await this.db.execute<RawIngredientRow>(
            sql`SELECT ${RETURNING} FROM ingredients WHERE id = ${id} LIMIT 1`,
        );

        return result.rows.length > 0 ? rowToIngredient(result.rows[0]!) : undefined;
    }

    /**
     * Batch-load ingredients by id (e.g. to gather a recipe's catalog nutrition in one query for the
     * per-serving aggregation). Returns only the rows that exist, in no guaranteed order.
     *
     * @param ids - The ingredient ids to load (deduplicated by the caller if desired).
     * @returns The matching ingredients (per-100g nutrition included when resolved).
     * @sideEffect Reads `ingredients`.
     */
    public async findByIds(ids: readonly string[]): Promise<Ingredient[]> {
        if (ids.length === 0) {
            return [];
        }

        const result = await this.db.execute<RawIngredientRow>(
            sql`SELECT ${RETURNING} FROM ingredients WHERE id IN (${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
            )})`,
        );

        return result.rows.map(rowToIngredient);
    }

    /**
     * Look up an existing food-backed ingredient by its opaque `food_id` (dedup key).
     *
     * @param foodId - The food-service internal id.
     * @returns The ingredient, or `undefined` when none references this food.
     * @sideEffect Reads `ingredients`.
     */
    public async findByFoodId(foodId: string): Promise<Ingredient | undefined> {
        const result = await this.db.execute<RawIngredientRow>(
            sql`SELECT ${RETURNING} FROM ingredients WHERE food_id = ${foodId} LIMIT 1`,
        );

        return result.rows.length > 0 ? rowToIngredient(result.rows[0]!) : undefined;
    }

    /**
     * Batch variant of {@link IngredientsDal.findByFoodId}: which of these foods ALREADY have a catalog row.
     *
     * The Stage-2 blended typeahead's dedup key. Deliberately a batch read rather than N single lookups: the
     * blend runs on a per-keystroke path, so the crosswalk must cost ONE indexed `food_id IN (…)` query, not
     * one round-trip per catalog hit. Returns only the rows that exist, in no guaranteed order (the caller
     * orders them by catalog relevance).
     *
     * @param foodIds - The opaque food-service ids to look up (deduplicated by the caller if desired).
     * @returns The matching food-backed ingredients (with any nutrition they already carry).
     * @sideEffect Reads `ingredients`.
     */
    public async findByFoodIds(foodIds: readonly string[]): Promise<Ingredient[]> {
        if (foodIds.length === 0) {
            return [];
        }

        const result = await this.db.execute<RawIngredientRow>(
            sql`SELECT ${RETURNING} FROM ingredients WHERE food_id IN (${sql.join(
                foodIds.map((foodId) => sql`${foodId}`),
                sql`, `,
            )})`,
        );

        return result.rows.map(rowToIngredient);
    }

    /**
     * Look up an existing freeform ingredient by case-insensitive name (freeform dedup key).
     *
     * @param name - The display name to match.
     * @returns The freeform ingredient, or `undefined` when none exists.
     * @sideEffect Reads `ingredients`.
     */
    public async findFreeformByName(name: string): Promise<Ingredient | undefined> {
        const result = await this.db.execute<RawIngredientRow>(
            sql`SELECT ${RETURNING} FROM ingredients
                WHERE is_user_entered = true AND lower(name) = lower(${name})
                LIMIT 1`,
        );

        return result.rows.length > 0 ? rowToIngredient(result.rows[0]!) : undefined;
    }

    /**
     * Create (or dedup-return) a freeform, user-entered ingredient (`is_user_entered = true`, no
     * `food_id`, no resolution status). Populates `search_vector` from the name (no DB trigger exists
     * for `ingredients`). If a freeform row with the same case-insensitive name already exists, that
     * row is returned instead of inserting a duplicate.
     *
     * @param name - The (already trimmed) display name.
     * @returns The created or pre-existing freeform ingredient.
     * @sideEffect Reads, then conditionally inserts into `ingredients`.
     */
    public async createFreeform(name: string): Promise<Ingredient> {
        const existing = await this.findFreeformByName(name);

        if (existing) {
            return existing;
        }

        // ON CONFLICT DO NOTHING closes the read-then-insert race: if a concurrent call inserted the
        // same freeform name between our SELECT and INSERT, the unique index (0006) rejects our row and
        // RETURNING is empty — we then re-read the winner's row instead of creating a duplicate.
        const result = await this.db.execute<RawIngredientRow>(sql`
            INSERT INTO ingredients (name, is_user_entered, search_vector)
            VALUES (${name}, true, to_tsvector('english', ${name}))
            ON CONFLICT DO NOTHING
            RETURNING ${RETURNING}
        `);

        const inserted = result.rows[0];

        if (inserted) {
            return rowToIngredient(inserted);
        }

        const winner = await this.findFreeformByName(name);

        if (!winner) {
            throw new Error(`Freeform ingredient "${name}" conflicted on insert but no existing row was found.`);
        }

        return winner;
    }

    /**
     * Create (or dedup-return) a food-service-backed ingredient. Dedups on the opaque `food_id`: if a
     * row already references this food, that row is returned. Populates `search_vector` from the name.
     *
     * @param input - Name, opaque `food_id`, and the async resolution status.
     * @returns The created or pre-existing food-backed ingredient.
     * @sideEffect Reads, then conditionally inserts into `ingredients`.
     */
    public async createFoodBacked(input: CreateFoodBackedInput): Promise<Ingredient> {
        const existing = await this.findByFoodId(input.foodId);

        if (existing) {
            return existing;
        }

        // ON CONFLICT DO NOTHING closes the read-then-insert race: if a concurrent call inserted the same
        // food_id between our SELECT and INSERT, the unique index (0006) rejects our row and RETURNING is
        // empty — we then re-read the winner's row instead of creating a duplicate catalog entry.
        const result = await this.db.execute<RawIngredientRow>(sql`
            INSERT INTO ingredients (name, food_id, food_resolution_status, is_user_entered, search_vector)
            VALUES (${input.name}, ${input.foodId}, ${input.foodResolutionStatus}, false,
                    to_tsvector('english', ${input.name}))
            ON CONFLICT DO NOTHING
            RETURNING ${RETURNING}
        `);

        const inserted = result.rows[0];

        if (inserted) {
            return rowToIngredient(inserted);
        }

        const winner = await this.findByFoodId(input.foodId);

        if (!winner) {
            throw new Error(
                `Food-backed ingredient (food_id ${input.foodId}) conflicted on insert but no row was found.`,
            );
        }

        return winner;
    }

    /**
     * Update a food-backed ingredient's resolution status, and (when the food resolved) its per-100g
     * nutrition. Nutrition values that are omitted are left untouched via `COALESCE`.
     *
     * @param id - The `ingredients.id`.
     * @param input - The new status and optional golden-record nutrition.
     * @returns The updated ingredient, or `undefined` when no row exists.
     * @sideEffect Updates `ingredients`.
     */
    public async updateResolution(id: string, input: UpdateResolutionInput): Promise<Ingredient | undefined> {
        const n = input.nutrition ?? {};
        const calories = n.caloriesPer100g ?? null;
        const protein = n.proteinGPer100g ?? null;
        const carbs = n.carbsGPer100g ?? null;
        const fat = n.fatGPer100g ?? null;
        // Serialize portions to a jsonb string; null → COALESCE leaves the existing column untouched.
        const portions = input.portions !== undefined ? JSON.stringify(input.portions) : null;

        const result = await this.db.execute<RawIngredientRow>(sql`
            UPDATE ingredients SET
                food_resolution_status = ${input.foodResolutionStatus},
                calories_per_100g  = COALESCE(${calories}, calories_per_100g),
                protein_g_per_100g = COALESCE(${protein}, protein_g_per_100g),
                carbs_g_per_100g   = COALESCE(${carbs}, carbs_g_per_100g),
                fat_g_per_100g     = COALESCE(${fat}, fat_g_per_100g),
                portions           = COALESCE(${portions}::jsonb, portions)
            WHERE id = ${id}
            RETURNING ${RETURNING}
        `);

        return result.rows.length > 0 ? rowToIngredient(result.rows[0]!) : undefined;
    }
}
