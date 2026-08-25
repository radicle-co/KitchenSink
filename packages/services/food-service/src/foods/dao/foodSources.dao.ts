/**
 * `FoodSourcesDao` (T-106, MOD-016) — the cross-source crosswalk. Upserts a `food_sources` row keyed
 * on `UNIQUE(source, external_key)` (recording/updating `item_version` + `fetch_state`), and resolves
 * a source item key or a product barcode back to the internal food `id`. The inserted row satisfies
 * `UNIQUE(food_id, id)`, the composite target the per-value same-food provenance FKs reference
 * (D-PROVENANCE-FK). No raw source payload is stored.
 *
 * @implements FR-008 FR-028 FR-029 FR-032
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { food, foodSources, type FoodSourceRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';

/** A wired source identifier (the `food_source` enum domain). */
export type FoodSource = FoodSourceRow['source'];

/** One backing source item of a `RESOLVED` food — the change-refresh scan unit (ARCH-018/MOD-020). */
export interface BackingItem {
    /** The internal food id this item backs. */
    foodId: string;
    /** The source the item came from. */
    source: FoodSource;
    /** That source's opaque key for the item (the re-fetch handle). */
    externalKey: string;
    /** The last-known per-item version/etag/hash, or `null` when never recorded. */
    itemVersion: string | null;
}

/** Input for {@link FoodSourcesDao.upsertSource}. */
export interface UpsertSourceInput {
    /** Internal food id this crosswalk row belongs to. */
    foodId: string;
    /** The source identifier (e.g. `usda`). */
    source: FoodSource;
    /** That source's primary key for the item (USDA: mapped from `fdcId` in the adapter). */
    externalKey: string;
    /** Per-item version/etag (optional). */
    itemVersion?: string | null;
    /** Operational fetch state (`fetched` | `error`); defaults to `fetched`. */
    fetchState?: 'fetched' | 'error';
}

export class FoodSourcesDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Upsert a crosswalk row keyed on `UNIQUE(source, external_key)`. A fresh item gets a new ULID
     * `id`; an existing item keeps its `id` and updates `item_version`/`fetch_state`/`fetched_at`. The
     * returned row's `(food_id, id)` is the composite target for per-value provenance FKs.
     *
     * @param input - Crosswalk attributes.
     * @returns The upserted crosswalk row.
     * @sideEffect Inserts or updates `food_sources`.
     */
    public async upsertSource(input: UpsertSourceInput): Promise<FoodSourceRow> {
        const fetchState = input.fetchState ?? 'fetched';
        const rows = await this.db
            .insert(foodSources)
            .values({
                id: newFoodId(),
                foodId: input.foodId,
                source: input.source,
                externalKey: input.externalKey,
                itemVersion: input.itemVersion ?? null,
                fetchState,
            })
            .onConflictDoUpdate({
                target: [foodSources.source, foodSources.externalKey],
                set: { itemVersion: input.itemVersion ?? null, fetchState, fetchedAt: new Date() },
            })
            .returning();

        const row = rows[0];

        if (!row) {
            throw new Error('upsertSource produced no row');
        }

        return row;
    }

    /**
     * Resolve a `(source, external_key)` to its internal food id via `UNIQUE(source, external_key)`.
     *
     * @param source - The source identifier.
     * @param externalKey - That source's item key.
     * @returns The food id, or `undefined` when the crosswalk has no such item.
     * @sideEffect Reads `food_sources`.
     */
    public async findFoodIdByExternalKey(source: FoodSource, externalKey: string): Promise<string | undefined> {
        const rows = await this.db
            .select({ foodId: foodSources.foodId })
            .from(foodSources)
            .where(and(eq(foodSources.source, source), eq(foodSources.externalKey, externalKey)))
            .limit(1);

        return rows[0]?.foodId;
    }

    /**
     * Resolve MANY `(source, external_key)` pairs to their internal food ids in ONE query.
     *
     * The on-demand live search (plan U29) needs this for every hit the source returned, so that a hit
     * already admitted to our catalog can be picked with zero further source calls while an unknown one is
     * marked as costing an admission. Doing it with {@link findFoodIdByExternalKey} in a loop would be a
     * textbook N+1 on the one path a cook is actively waiting on — twenty round-trips inside a request that
     * has already spent a multi-second source call.
     *
     * ⚠️ Absent keys are simply ABSENT from the returned map rather than mapped to `undefined`, so a caller
     * distinguishes "not in our catalog" by lookup failure and cannot mistake a present-but-undefined entry
     * for a real id.
     *
     * @param source - The source identifier.
     * @param externalKeys - That source's item keys. An empty list short-circuits without querying.
     * @returns A map from `external_key` to food id, containing only the keys that are crosswalked.
     * @sideEffect Reads `food_sources`.
     */
    public async findFoodIdsByExternalKeys(
        source: FoodSource,
        externalKeys: readonly string[],
    ): Promise<Map<string, string>> {
        if (externalKeys.length === 0) {
            return new Map();
        }

        const rows = await this.db
            .select({ externalKey: foodSources.externalKey, foodId: foodSources.foodId })
            .from(foodSources)
            .where(and(eq(foodSources.source, source), inArray(foodSources.externalKey, [...externalKeys])));

        return new Map(rows.map((row) => [row.externalKey, row.foodId]));
    }

    /**
     * Resolve a `(source, external_key)` to its FULL crosswalk row via `UNIQUE(source, external_key)`.
     * The bulk-seed importer needs the row (not just the `food_id`) so it can compare the recorded
     * `item_version` against the incoming bulk item's version and skip an unchanged food outright — the
     * fast path that makes a re-run over ~8k rows resumable instead of 8k no-op transactions.
     *
     * @param source - The source identifier.
     * @param externalKey - That source's item key.
     * @returns The crosswalk row, or `undefined` when the crosswalk has no such item.
     * @sideEffect Reads `food_sources`.
     */
    public async findByExternalKey(source: FoodSource, externalKey: string): Promise<FoodSourceRow | undefined> {
        const rows = await this.db
            .select()
            .from(foodSources)
            .where(and(eq(foodSources.source, source), eq(foodSources.externalKey, externalKey)))
            .limit(1);

        return rows[0];
    }

    /**
     * Resolve a product barcode to its internal food id via the partial `food_barcode_idx`.
     *
     * @param barcode - The product barcode.
     * @returns The food id, or `undefined` when no food carries that barcode.
     * @sideEffect Reads `food`.
     */
    public async findFoodIdByBarcode(barcode: string): Promise<string | undefined> {
        const rows = await this.db.select({ id: food.id }).from(food).where(eq(food.barcode, barcode)).limit(1);

        return rows[0]?.id;
    }

    /**
     * List a food's backing crosswalk rows (the change-refresh re-pull iterates these, T-171).
     *
     * @param foodId - The internal food id.
     * @returns The crosswalk rows for the food.
     * @sideEffect Reads `food_sources`.
     */
    public async listByFood(foodId: string): Promise<FoodSourceRow[]> {
        return this.db.select().from(foodSources).where(eq(foodSources.foodId, foodId));
    }

    /**
     * List the backing items of **live-origin** `RESOLVED` foods for the change-refresh scan
     * (T-170/MOD-020). Two exclusions, both load-bearing:
     *
     * - `status = 'RESOLVED'` skips `NOT_FOUND`/`FAILED` tombstones — never refreshed (FR-032);
     * - `origin <> 'bulk'` skips foods imported from the USDA **bulk** download (F-C2, migration 0003).
     *   This is CORRECTNESS-critical, not a quota nicety: a bulk crosswalk row's `item_version` is
     *   derived from the bulk file's content and can never equal an API `publicationDate`, so an
     *   unexcluded bulk food would compare "changed" on EVERY sweep — re-enqueued forever, and the
     *   drain's `mergeChangedSources` would overwrite its lab-analyzed bulk nutrition with API values.
     *   It also protects the shared 1,000/hr per-IP USDA window from ~8k pointless re-fetches per sweep
     *   (SR Legacy is frozen upstream and never changes). Bulk foods are re-freshened from the next bulk
     *   download instead.
     *
     * Ordered by `food_id` for stable paging; bounded by `limit` (the limit applies AFTER the filters, so
     * a large bulk catalog can never starve the live foods out of a pass).
     *
     * @param limit - Max rows to return (the scan budget bound).
     * @returns The backing items of live-origin `RESOLVED` foods.
     * @sideEffect Reads `food_sources` joined to `food`.
     */
    public async listResolvedBackingItems(limit = 1000): Promise<BackingItem[]> {
        const result = await this.db.execute<{
            food_id: string;
            source: FoodSource;
            external_key: string;
            item_version: string | null;
        }>(sql`
            SELECT fs.food_id, fs.source, fs.external_key, fs.item_version
              FROM food_sources fs
              JOIN food f ON f.id = fs.food_id
             WHERE f.status = 'RESOLVED'
               AND f.origin <> 'bulk'
             ORDER BY fs.food_id
             LIMIT ${limit}
        `);

        return result.rows.map((row) => ({
            foodId: row.food_id,
            source: row.source,
            externalKey: row.external_key,
            itemVersion: row.item_version,
        }));
    }

    /**
     * Resolve the crosswalk row id (`= source_id`) for a `(food_id, source)`. Used by the provenance
     * layer (MOD-019) to stamp per-value/per-field provenance.
     *
     * @param foodId - The internal food id.
     * @param source - The source identifier.
     * @returns The crosswalk row id, or `undefined` when this food has no row for that source.
     * @sideEffect Reads `food_sources`.
     */
    public async findSourceId(foodId: string, source: FoodSource): Promise<string | undefined> {
        const rows = await this.db
            .select({ id: foodSources.id })
            .from(foodSources)
            .where(and(eq(foodSources.foodId, foodId), eq(foodSources.source, source)))
            .limit(1);

        return rows[0]?.id;
    }
}
