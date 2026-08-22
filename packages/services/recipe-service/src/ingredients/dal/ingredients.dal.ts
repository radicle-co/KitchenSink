/**
 * T027 — `IngredientsDal`: the data-access layer for the 001-owned `ingredients` catalog.
 *
 * Owns three responsibilities (data-model.md `ingredients` section):
 *   1. **Fuzzy + full-text search** — a single ranked read combining the `pg_trgm` GIN index
 *      (`idx_ingredients_name_trgm`, typo/substring tolerant) with the tsvector FTS index
 *      (`idx_ingredients_search_vector`). Since plan U5/U6 the WHICH is chosen by the pure
 *      {@link selectIngredientMatchStrategy} and the ORDER by the Scoring Policy in
 *      `ingredientRelevance.ts` — a tier ladder layered above `word_similarity`, which is what breaks the
 *      1.00/1.00 tie that let `Carob flour` win `flour` alphabetically. See {@link IngredientsDal.search}.
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
import type { Ingredient } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/database.module.js';
import type { CanonicalIngredientName } from '../domain/ingredientName.js';
import { selectIngredientMatchStrategy } from '../selectIngredientMatchStrategy.js';
import { localTieredSortKey } from './ingredientRelevance.js';

/** Default number of search hits returned when the caller does not specify a limit. */
export const DEFAULT_SEARCH_LIMIT = 10;

/** Hard ceiling on search hits (mirrors the OpenAPI `limit` maximum). */
export const MAX_SEARCH_LIMIT = 50;

/**
 * The explicit column projection returned by every DAL read/write (never the `search_vector`).
 *
 * ⛔ NO NUTRITION COLUMNS (KTD-3 / plan U10, migration 0019). They were copies of the food service's data
 * taken at resolution time, with no invalidation — so the same recipe could report different calories from
 * different rows. This table holds the REFERENCE (`food_id`) and nothing derived from it; nutrition is read
 * live through `FoodNutritionGateway`. Adding one back re-creates the second source of truth U10 deleted.
 */
const RETURNING = sql`id, name, food_id, food_resolution_status, is_user_entered, created_at`;

/** Input to {@link IngredientsDal.createFoodBacked}. */
export interface CreateFoodBackedInput {
    /** Display name of the ingredient. */
    readonly name: CanonicalIngredientName;
    /** Opaque food-service internal id (ULID) backing this ingredient. */
    readonly foodId: string;
    /** The async resolution status returned by the food service. */
    readonly foodResolutionStatus: FoodResolutionStatus;
}

/** Input to {@link IngredientsDal.updateResolution}. */
export interface UpdateResolutionInput {
    /** The new resolution status. */
    readonly foodResolutionStatus: FoodResolutionStatus;
    /**
     * The golden record's canonical display name, to ADOPT as this shared catalog row's name (plan U3).
     *
     * Omitted means "leave the name exactly as it is" — which is the answer whenever the food did not resolve
     * to a record carrying a usable name, since `ingredients.name` is `NOT NULL` and the caller's own text is
     * the only label the row has. The decision is not made here; it is made once, by `canonicalNameFrom`.
     */
    readonly canonicalName?: CanonicalIngredientName;
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

    created_at: Date | string;
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
     * Ranked fuzzy + full-text search over the shared ingredient catalog.
     *
     * DESIGN PATTERN: **Strategy**, chosen by the pure, database-free
     * {@link selectIngredientMatchStrategy} and dispatched exhaustively below — the switch over the union
     * tag IS the Visitor — plus the **Scoring Policy** in `ingredientRelevance.ts`, which owns the sort key.
     * Neither decision is made here; this method binds them to a statement.
     *
     * **What matches (retrieval).** The pre-existing predicate, unchanged: the tsvector FTS path
     * (`search_vector @@ plainto_tsquery`, word-order-independent), OR the `pg_trgm` fuzzy fallback
     * (`query <% name` word-similarity, or a substring `ILIKE`). A MULTI-TOKEN query additionally
     * retrieves rows carrying its HEAD TERM (plan U6) — see below for why that is not optional.
     *
     * **What wins (ranking).** `word_similarity`, not full-string `similarity`/`%`, so a short typo query
     * still matches a long multi-word name: `'flor'` vs `'All-purpose flour'` scores 0.600 by word
     * similarity and only 0.15 full-string, which falls below the 0.3 `%` threshold (KTD-1). Since plan U5
     * that metric is the BASE of a tiered sort key rather than the whole of it.
     *
     * ⛔ **The tie the ladder exists to break.** Measured on `postgres:16`, 2026-08-22:
     * `word_similarity('flour', 'Flour')` and `word_similarity('flour', 'Carob flour')` BOTH return 1.00 —
     * word similarity scores the best matching word extent and does not penalise extra words — so
     * `name ASC` decided, and `'Carob flour' < 'Flour'`. The attractor won by the alphabet, on the surface
     * that decided 92.8% of the import's lines. `ingredientRelevance.ts` documents the ladder.
     *
     * ⛔ **Widening retrieval and tiering the sort key ship TOGETHER.** `plainto_tsquery` is a conjunction
     * of every lexeme, so `sifted flour` asks for `sift & flour` and never retrieves `Flour, wheat,
     * all-purpose` at all — that is the shape of the import's 268 unmatched lines. Retrieving on the head
     * term alone fixes it, but only because the ladder then puts the extra candidates on the rung they
     * deserve; against the OLD sort key the same widening would just add noise to the page.
     *
     * @param query - The (already trimmed) user query. An empty query returns no rows.
     * @param limit - Max hits (clamped to `[1, MAX_SEARCH_LIMIT]`; defaults to `DEFAULT_SEARCH_LIMIT`).
     * @returns Ranked ingredient hits, or an empty array when nothing matches.
     * @sideEffect Reads `ingredients`.
     */
    public async search(query: string, limit?: number): Promise<Ingredient[]> {
        const strategy = selectIngredientMatchStrategy(query);

        if (strategy.kind === 'none') {
            return [];
        }

        const pattern = `%${query}%`;
        const sortKey = localTieredSortKey(strategy, sql`word_similarity(${query}, ingredients.name)`);
        // The head-term branch, or nothing. A single-token query's predicate stays byte-identical to the
        // pre-U6 one — `plainto_tsquery` on one lexeme already IS the head-term retrieval, so OR'ing it in
        // would be a duplicate branch for the planner to cost.
        const headRetrieval =
            strategy.kind === 'multiToken'
                ? sql` OR search_vector @@ plainto_tsquery('english', ${strategy.headTerm})`
                : sql``;

        // ⚠️ The score is PROJECTED and the `ORDER BY` references its alias, exactly as food-service's
        // statement does — so the ranking has ONE authoritative definition and cannot drift from the order
        // rows come back in. It is not part of {@link RETURNING} and never reaches the domain shape:
        // `rowToIngredient` reads named fields only, and `Ingredient` carries no score.
        const result = await this.db.execute<RawIngredientRow>(sql`
            SELECT ${RETURNING}, ${sortKey.score} AS score
            FROM ingredients
            ${sortKey.lateral}
            WHERE search_vector @@ plainto_tsquery('english', ${query})
               OR ${query} <% ingredients.name
               OR ingredients.name ILIKE ${pattern}${headRetrieval}
            ORDER BY score DESC,
                     ingredients.name ASC
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
    public async createFreeform(name: CanonicalIngredientName): Promise<Ingredient> {
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
     * Update a food-backed ingredient's resolution STATUS, and — when the food resolved to a golden record
     * with a usable name — adopt that name as the shared catalog row's display name (plan U3).
     *
     * ⛔ It no longer persists nutrition (plan U10). It used to copy the golden record's per-100g values and
     * portions into this table at resolution time, which is precisely the duplicate KTD-3 removes: a copy
     * with no invalidation, so a food corrected upstream left every recipe quoting the old number forever.
     * The status still lives here because it is about THIS ingredient's link to a food, not about the food.
     *
     * ⛔ **The rename RECOMPUTES `search_vector` in the SAME statement, and that is load-bearing.** There is
     * no trigger maintaining `ingredients.search_vector` — `0001_initial.sql` creates exactly one and it is on
     * `recipes` — so this DAL owns the vector on every write (see the file header). A plain `SET name` would
     * leave the FTS index still spelling whatever prose the caller originally supplied, so the row would
     * DISPLAY the golden name and be FOUND by text no user ever typed. `COALESCE(…::text, name)` is what makes
     * an omitted `canonicalName` a true no-op on both columns rather than a blanking write; the explicit
     * `::text` is required because a `null` parameter has no inferrable type inside `to_tsvector`. Note the
     * vector is recomputed even in that no-op case, deliberately: it costs one expression and makes
     * `search_vector = to_tsvector('english', name)` an invariant this statement RESTORES rather than merely
     * preserves.
     *
     * ⚠️ `recipe_ingredients.ingredient_name` is deliberately NOT touched. That column is the denormalized
     * display text of one line of one user's recipe — what the cook wrote — and is a different fact from the
     * catalog's shared label.
     *
     * @param id - The `ingredients.id`.
     * @param input - The new resolution status, and optionally the canonical name to adopt.
     * @returns The updated ingredient, or `undefined` when no row exists.
     * @sideEffect Updates `ingredients`.
     */
    public async updateResolution(id: string, input: UpdateResolutionInput): Promise<Ingredient | undefined> {
        const canonicalName = input.canonicalName ?? null;
        const result = await this.db.execute<RawIngredientRow>(sql`
            UPDATE ingredients SET
                food_resolution_status = ${input.foodResolutionStatus},
                name          = COALESCE(${canonicalName}::text, name),
                search_vector = to_tsvector('english', COALESCE(${canonicalName}::text, name))
            WHERE id = ${id}
            RETURNING ${RETURNING}
        `);

        return result.rows.length > 0 ? rowToIngredient(result.rows[0]!) : undefined;
    }
}
