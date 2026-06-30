/**
 * `FoodSourcesDao` (T-106, MOD-016) — the cross-source crosswalk. Upserts a `food_sources` row keyed
 * on `UNIQUE(source, external_key)` (recording/updating `item_version` + `fetch_state`), and resolves
 * a source item key or a product barcode back to the internal food `id`. The inserted row satisfies
 * `UNIQUE(food_id, id)`, the composite target the per-value same-food provenance FKs reference
 * (D-PROVENANCE-FK). No raw source payload is stored.
 *
 * @implements FR-008 FR-028 FR-029 FR-032
 */
import { and, eq } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { food, foodSources, type FoodSourceRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';

/** A wired source identifier (the `food_source` enum domain). */
export type FoodSource = FoodSourceRow['source'];

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
