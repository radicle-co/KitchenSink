/**
 * `FoodSourcesDao` (T-106, MOD-016) — the cross-source crosswalk. Upserts a `food_sources` row keyed
 * on `UNIQUE(source, external_key)` (recording/updating `item_version` + `fetch_state`), and resolves
 * a source item key or a product barcode back to the internal food `id`. The inserted row satisfies
 * `UNIQUE(food_id, id)`, the composite target the per-value same-food provenance FKs reference
 * (D-PROVENANCE-FK). No raw source payload is stored.
 *
 * @implements FR-008 FR-028 FR-029 FR-032
 */
import { isLineageKey, type LineageKey } from '@kitchensink/usda-client';
import { and, eq, getTableColumns, isNull, sql, type SQL } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { food, foodItem, foodSources, type FoodSourceRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { datasetsOfSource } from '../seed/citationDatasets.js';
import { itemIdOfFood } from './foodItem.dao.js';

/** A wired source identifier (the `food_source` enum domain). */
export type FoodSource = FoodSourceRow['source'];

/** The root or variant that owns one keyed source item (curated plan U8 S4). */
export interface ItemOwner {
    /** The source's key for the item. */
    readonly externalKey: string;
    readonly kind: 'root' | 'variant';
    /** The root's or the variant's id. */
    readonly id: string;
    /** Whether the seed owns the item (it has a natural key). */
    readonly seedOwned: boolean;
}

/** The root or variant that owns an item whose source row holds a lineage key (curated plan R19). */
export interface LineageHolder {
    /** The lineage key the row holds. */
    readonly lineageKey: LineageKey;
    /** The row's own key: the version of the food the seed pinned. */
    readonly externalKey: string;
    readonly kind: 'root' | 'variant';
    /** The root's or the variant's id. */
    readonly id: string;
    /** Whether the seed owns the item. */
    readonly seedOwned: boolean;
}

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

/** The catalog food a crosswalk names: its id and its name. */
export interface CatalogFoodHit {
    readonly id: string;
    readonly name: string | null;
}

/**
 * The rows the shared catalog search may list: no author, not retired, `RESOLVED`. A crosswalk hit is unshifted onto
 * that answer for every caller (plan 002 S3, property 2), so each crosswalk read applies these conditions in its own
 * statement. Pure.
 *
 * @returns The conditions, to be AND-ed with the read's own match.
 */
function listedCatalogFood(): SQL[] {
    return [isNull(food.userId), isNull(food.retiredAt), eq(food.status, 'RESOLVED')];
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
    public constructor(private readonly db: FoodWriter) {}

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
                // The crosswalk keys on the food's item (curated catalog plan KTD-6).
                itemId: itemIdOfFood(input.foodId),
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
     * Claim a source item for a food: insert its crosswalk row only while no row holds the key, `ON CONFLICT ON
     * CONSTRAINT food_sources_source_key_unique DO NOTHING`. Unlike {@link upsertSource}, it never touches a row another
     * food already holds, so a writer that lost a race learns it instead of writing over the winner (ADR-0055 point 10).
     *
     * @param input - The food, the source and the item's key.
     * @returns `true` when this call claimed the item; `false` when another food holds it.
     * @sideEffect May insert into `food_sources`.
     */
    public async claimSource(input: Pick<UpsertSourceInput, 'foodId' | 'source' | 'externalKey'>): Promise<boolean> {
        const rows = await this.db
            .insert(foodSources)
            .values({
                id: newFoodId(),
                itemId: itemIdOfFood(input.foodId),
                source: input.source,
                externalKey: input.externalKey,
            })
            .onConflictDoNothing({ target: [foodSources.source, foodSources.externalKey] })
            .returning({ id: foodSources.id });

        return rows.length === 1;
    }

    /**
     * Resolve a product barcode to the catalog food carrying it, via the partial `food_barcode_idx`.
     *
     * {@link listedCatalogFood} only: an authored food here would reach a stranger (ADR-0036). The predicate is in the
     * query, not in the caller, so an authored row cannot take the `LIMIT 1` from a catalog row with the same barcode.
     *
     * @param barcode - The product barcode.
     * @returns The food's id and name, or `undefined` when no such catalog food carries that barcode.
     * @sideEffect Reads `food`.
     */
    public async findCatalogFoodByBarcode(barcode: string): Promise<CatalogFoodHit | undefined> {
        return this.findListedCatalogFood(eq(food.barcode, barcode));
    }

    /**
     * The root a USDA key's owner names, read again under {@link listedCatalogFood} (sec-aud-1 S3 review, F1). The owner
     * reader follows citations, lineage and forwards to that root and keeps to the catalog in TypeScript; this read is
     * what lets only the SQL publish it.
     *
     * @param id - The root id the owner reader answered.
     * @returns The food's id and name, or `undefined` when the id names no listed catalog food.
     * @sideEffect Reads `food`.
     */
    public async findCatalogFoodById(id: string): Promise<CatalogFoodHit | undefined> {
        return this.findListedCatalogFood(eq(food.id, id));
    }

    /**
     * The first {@link listedCatalogFood} row the match admits.
     *
     * @param match - The read's own condition.
     * @returns The food's id and name, or `undefined`.
     * @sideEffect Reads `food`.
     */
    private async findListedCatalogFood(match: SQL): Promise<CatalogFoodHit | undefined> {
        const rows = await this.db
            .select({ id: food.id, name: food.name })
            .from(food)
            .where(and(match, ...listedCatalogFood()))
            .limit(1);

        return rows[0];
    }

    /**
     * The crosswalk rows a live refresh may re-pull for one food: none when the food's item is seed-owned (curated
     * catalog plan U4, R14). The same exclusion as {@link FoodSourcesDao.listResolvedBackingItems}, for the refresh
     * that arrives one food at a time (an operator's refetch): the seed is a seeded item's one writer, and the
     * ownership trigger would refuse a merge's writes on every attempt.
     *
     * @param foodId - The food.
     * @returns Its re-pullable crosswalk rows.
     * @sideEffect Reads `food_sources` joined to `food` and `food_item`.
     */
    public async listRefreshableByFood(foodId: string): Promise<FoodSourceRow[]> {
        return this.db
            .select(getTableColumns(foodSources))
            .from(foodSources)
            .innerJoin(food, eq(food.itemId, foodSources.itemId))
            .innerJoin(foodItem, eq(foodItem.id, foodSources.itemId))
            .where(and(eq(food.id, foodId), eq(foodItem.seedOwned, false)));
    }

    /**
     * List the backing items of **live** (not seed-owned) `RESOLVED` foods for the change-refresh scan
     * (T-170/MOD-020). Two exclusions, both load-bearing:
     *
     * - `status = 'RESOLVED'` skips `NOT_FOUND`/`FAILED` tombstones — never refreshed (FR-032);
     * - `NOT seed_owned` skips every row the seed owns (curated catalog plan U4, R14). This is
     *   CORRECTNESS-critical, not a quota nicety: the seed is the single writer of a seeded item's numbers,
     *   so a refresh would either overwrite them with API values or be refused by the ownership trigger on
     *   every sweep. It also protects the shared per-key USDA window from ~8k pointless re-fetches
     *   per sweep (SR Legacy is frozen upstream and never changes). It replaces 0003's `origin <> 'bulk'`.
     *
     * Ordered by food id for stable paging; bounded by `limit` (the limit applies AFTER the filters, so a
     * large seeded catalog can never starve the live foods out of a pass). Only a root's item is listed: a
     * variant's item is always seed-owned.
     *
     * @param limit - Max rows to return (the scan budget bound).
     * @returns The backing items of live `RESOLVED` foods.
     * @sideEffect Reads `food_sources` joined to `food` and `food_item`.
     */
    public async listResolvedBackingItems(limit = 1000): Promise<BackingItem[]> {
        const result = await this.db.execute<{
            food_id: string;
            source: FoodSource;
            external_key: string;
            item_version: string | null;
        }>(sql`
            SELECT f.id AS food_id, fs.source, fs.external_key, fs.item_version
              FROM food_sources fs
              JOIN food f ON f.item_id = fs.item_id
              JOIN food_item i ON i.id = fs.item_id
             WHERE f.status = 'RESOLVED'
               AND NOT i.seed_owned
             ORDER BY f.id
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
            .innerJoin(food, eq(food.itemId, foodSources.itemId))
            .where(and(eq(food.id, foodId), eq(foodSources.source, source)))
            .limit(1);

        return rows[0]?.id;
    }

    /**
     * The owner of each keyed source item (curated plan U8 S4, R19): the root or the variant that owns the item, read
     * off the item's `owner_kind`. Joined on `food_sources.external_key`, the adapter's bare spelling — never on
     * `food_item.natural_key`, which is the seed's `fdc:` spelling.
     *
     * Every owner comes back, retired and authored ones included: following forwards and keeping to the catalog is
     * the owner reader's job.
     *
     * @param source - The source.
     * @param externalKeys - That source's keys, as its adapter spells them.
     * @returns One entry per key that names an item; a key that names none is absent.
     * @sideEffect Reads `food_sources`, `food_item`, `food` and `food_variant`.
     */
    public async ownersOf(source: FoodSource, externalKeys: readonly string[]): Promise<ItemOwner[]> {
        if (externalKeys.length === 0) {
            return [];
        }

        const result = await this.db.execute<{
            external_key: string;
            kind: 'root' | 'variant';
            owner_id: string | null;
            seed_owned: boolean;
        }>(sql`
            SELECT fs.external_key, i.owner_kind::text AS kind, coalesce(f.id, v.id) AS owner_id, i.seed_owned
              FROM food_sources fs
              JOIN food_item i ON i.id = fs.item_id
              LEFT JOIN food f ON i.owner_kind = 'root' AND f.item_id = i.id
              LEFT JOIN food_variant v ON i.owner_kind = 'variant' AND v.item_id = i.id
             WHERE fs.source = ${source} AND fs.external_key = ANY(${sql.param([...externalKeys])})
        `);

        return result.rows.flatMap((row) =>
            row.owner_id === null
                ? []
                : [{ externalKey: row.external_key, kind: row.kind, id: row.owner_id, seedOwned: row.seed_owned }],
        );
    }

    /**
     * The owner of every item whose source row holds one of these lineage keys (curated plan R19): the entries a newer
     * version of the food stands for. A key may name several rows, because an earlier version keeps its row when its
     * owner retires (KTD-8). Every owner comes back, retired and authored ones included: following forwards and
     * keeping to the catalog is the owner reader's job.
     *
     * @param source - The source.
     * @param lineageKeys - The lineage keys.
     * @returns One entry per row that holds a key and has an owner.
     * @sideEffect Reads `food_sources`, `food_item`, `food` and `food_variant`.
     */
    public async ownersOfLineage(source: FoodSource, lineageKeys: readonly LineageKey[]): Promise<LineageHolder[]> {
        if (lineageKeys.length === 0) {
            return [];
        }

        const result = await this.db.execute<{
            lineage_key: string;
            external_key: string;
            kind: 'root' | 'variant';
            owner_id: string | null;
            seed_owned: boolean;
        }>(sql`
            SELECT fs.lineage_key, fs.external_key, i.owner_kind::text AS kind, coalesce(f.id, v.id) AS owner_id,
                   i.seed_owned
              FROM food_sources fs
              JOIN food_item i ON i.id = fs.item_id
              LEFT JOIN food f ON i.owner_kind = 'root' AND f.item_id = i.id
              LEFT JOIN food_variant v ON i.owner_kind = 'variant' AND v.item_id = i.id
             WHERE fs.source = ${source} AND fs.lineage_key = ANY(${sql.param([...lineageKeys])})
             ORDER BY fs.lineage_key, fs.external_key
        `);

        // The format CHECK admits only lineage keys, so the guard narrows the type and drops nothing.
        return result.rows.flatMap((row) =>
            row.owner_id === null || !isLineageKey(row.lineage_key)
                ? []
                : [
                      {
                          lineageKey: row.lineage_key,
                          externalKey: row.external_key,
                          kind: row.kind,
                          id: row.owner_id,
                          seedOwned: row.seed_owned,
                      },
                  ],
        );
    }

    /**
     * The live seed-owned root that cites each key EXACTLY on its own nutrition (curated plan U8 S4, R19): a stand-in.
     * Only the root arm of a citation counts, and only the datasets the source publishes. A same-substance, close or
     * generic citation lends a root its numbers but names no root, because one such entry stands in for many foods
     * (ADR-0052). The seed refuses an entry graded exact for two roots. If two ever exist, the seed key in byte order,
     * then the id, decides.
     *
     * @param source - The source.
     * @param externalKeys - Keys no item owns.
     * @returns The citing root's id by key.
     * @sideEffect Reads `food_nutrition_citation`, `food_nutrition`, `food` and `food_item`.
     */
    public async citingSeedRoots(source: FoodSource, externalKeys: readonly string[]): Promise<Map<string, string>> {
        const datasets = datasetsOfSource(source);

        if (externalKeys.length === 0 || datasets.length === 0) {
            return new Map();
        }

        // A tie goes to the unique seed key in byte order: a name, or a key under the database's collation (en_US
        // ignores the hyphen), would let the collation pick the stand-in.
        const result = await this.db.execute<{ external_key: string; root_id: string }>(sql`
            SELECT DISTINCT ON (c.external_key) c.external_key, f.id AS root_id
              FROM food_nutrition_citation c
              JOIN food_nutrition h ON h.id = c.nutrition_id
              JOIN food f ON f.id = h.food_id
              JOIN food_item i ON i.id = f.item_id
             WHERE c.dataset = ANY(${sql.param(datasets)}::citation_dataset[])
               AND c.external_key = ANY(${sql.param([...externalKeys])})
               AND c.match = 'exact'
               AND i.seed_owned
               AND f.user_id IS NULL
               AND f.retired_at IS NULL
             ORDER BY c.external_key, f.seed_key COLLATE "C" ASC, f.id ASC
        `);

        return new Map(result.rows.map((row) => [row.external_key, row.root_id]));
    }
}
