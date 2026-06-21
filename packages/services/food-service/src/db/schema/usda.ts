/**
 * Drizzle table definitions for the `kitchensink_food` logical database (feature 003).
 *
 * Tables: `foods`, `fetch_queue`, `fetch_requesters`, `usda_sync_metadata`, `usda_call_log`.
 * Column types follow plan §2 and spec FR-028 exactly. There is intentionally NO
 * `rate_limiter_state` (replaced by the rolling-60-min `usda_call_log`) and NO
 * `user_fetch_quota` / `global_fetch_quota` (fairness is by queue demotion at drain time).
 *
 * @implements FR-014 FR-015 FR-019 FR-028 FR-029 FR-043 FR-044
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    bigserial,
    check,
    customType,
    decimal,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';

/** Postgres `tsvector` column (full-text search). Maintained by the search indexer (T-023). */
const tsvector = customType<{ data: string; driverData: string }>({
    dataType() {
        return 'tsvector';
    },
});

/**
 * Local USDA food data store (FR-028). One row per FDC id. `fetch_status` carries the lifecycle
 * enum `pending | fetched | failed | not_found | stale`; macro/micro nutrients are nullable
 * `decimal` (per 100g); `raw_json` preserves the verbatim USDA payload.
 */
export const foods = pgTable(
    'foods',
    {
        fdcId: integer('fdc_id').primaryKey(),
        description: text('description'),
        dataType: text('data_type'),
        // FR-028 lifecycle enum; the application/migration enforces the check constraint.
        fetchStatus: text('fetch_status').notNull().default('pending'),
        upcCode: text('upc_code'),
        brandOwner: text('brand_owner'),
        brandName: text('brand_name'),
        // Macro nutrients (per 100g).
        calories: decimal('calories'),
        proteinG: decimal('protein_g'),
        carbsG: decimal('carbs_g'),
        fatG: decimal('fat_g'),
        fiberG: decimal('fiber_g'),
        sodiumMg: decimal('sodium_mg'),
        // Extended nutrients.
        sugarG: decimal('sugar_g'),
        saturatedFatG: decimal('saturated_fat_g'),
        cholesterolMg: decimal('cholesterol_mg'),
        // Micros.
        vitaminAIu: decimal('vitamin_a_iu'),
        vitaminCMg: decimal('vitamin_c_mg'),
        calciumMg: decimal('calcium_mg'),
        ironMg: decimal('iron_mg'),
        rawJson: jsonb('raw_json'),
        searchVector: tsvector('search_vector'),
        requestCount: integer('request_count').notNull().default(0),
        fetchedAt: timestamp('fetched_at', { withTimezone: true }),
        lastRequestedAt: timestamp('last_requested_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        // FR-028 lifecycle enum — the ORM documents the constraint the migration enforces.
        check(
            'foods_fetch_status_check',
            sql`${table.fetchStatus} IN ('pending', 'fetched', 'not_found', 'failed', 'stale')`,
        ),
        index('idx_foods_fetch_status_fetched_at').on(table.fetchStatus, table.fetchedAt),
        index('idx_foods_last_requested').on(table.lastRequestedAt),
        index('idx_foods_search').using('gin', table.searchVector),
        index('idx_foods_data_type').on(table.dataType),
        index('idx_foods_upc').on(table.upcCode),
    ],
);

/** A `foods` row as selected. */
export type FoodRow = InferSelectModel<typeof foods>;
/** A `foods` row for insert. */
export type NewFoodRow = InferInsertModel<typeof foods>;

/**
 * Demand-weighted Postgres-as-queue (FR-014, FR-015). One row per pending `fdc_id`; dedup via
 * `ON CONFLICT (fdc_id)`. `status` is `pending | in_flight | tombstone`. The partial priority
 * index drives the worker's `ORDER BY request_count DESC, first_requested ASC` selection.
 */
export const fetchQueue = pgTable(
    'fetch_queue',
    {
        fdcId: text('fdc_id').primaryKey(),
        requestCount: integer('request_count').notNull().default(1),
        firstRequested: timestamp('first_requested', { withTimezone: true }).notNull().defaultNow(),
        lastRequested: timestamp('last_requested', { withTimezone: true }).notNull().defaultNow(),
        status: text('status').notNull().default('pending'),
        attempts: integer('attempts').notNull().default(0),
        lastError: text('last_error'),
        fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    },
    (table) => [
        // FR-014/FR-015 status enum — the ORM documents the constraint the migration enforces.
        check('fetch_queue_status_check', sql`${table.status} IN ('pending', 'in_flight', 'tombstone')`),
        index('idx_fetch_queue_priority')
            .on(sql`${table.requestCount} DESC`, sql`${table.firstRequested} ASC`)
            .where(sql`${table.status} = 'pending'`),
    ],
);

/** A `fetch_queue` row as selected. */
export type FetchQueueRow = InferSelectModel<typeof fetchQueue>;
/** A `fetch_queue` row for insert. */
export type NewFetchQueueRow = InferInsertModel<typeof fetchQueue>;

/**
 * Distinct-requester demand (FR-044) + per-`sub` pending-count source for fairness-by-demotion
 * (FR-043) and WebSocket targeting. Composite PK `(fdc_id, sub)`; the `sub` index supports the
 * live per-`sub` pending count computed at drain time.
 */
export const fetchRequesters = pgTable(
    'fetch_requesters',
    {
        fdcId: text('fdc_id').notNull(),
        sub: text('sub').notNull(),
        requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.fdcId, table.sub] }), index('idx_fetch_requesters_sub').on(table.sub)],
);

/** A `fetch_requesters` row as selected. */
export type FetchRequesterRow = InferSelectModel<typeof fetchRequesters>;
/** A `fetch_requesters` row for insert. */
export type NewFetchRequesterRow = InferInsertModel<typeof fetchRequesters>;

/**
 * Singleton sync-metadata row (`id = 1`) tracking the last full/incremental sync timestamps and
 * the per-dataset USDA versions (FR-031 bulk sync).
 */
export const usdaSyncMetadata = pgTable('usda_sync_metadata', {
    id: integer('id').primaryKey().default(1),
    lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
    lastIncrementalAt: timestamp('last_incremental_at', { withTimezone: true }),
    foundationVersion: text('foundation_version'),
    srLegacyVersion: text('sr_legacy_version'),
    brandedVersion: text('branded_version'),
});

/** A `usda_sync_metadata` row as selected. */
export type UsdaSyncMetadataRow = InferSelectModel<typeof usdaSyncMetadata>;
/** A `usda_sync_metadata` row for insert. */
export type NewUsdaSyncMetadataRow = InferInsertModel<typeof usdaSyncMetadata>;

/**
 * Rolling 60-minute USDA-call window (FR-019, FR-020). One timestamped row per USDA call; the
 * trailing-60-min count is `COUNT(*)` over `called_at > now() - interval '60 minutes'`. Rows
 * older than 60 min are irrelevant and pruned. Replaces the old token-bucket `rate_limiter_state`.
 */
export const usdaCallLog = pgTable(
    'usda_call_log',
    {
        id: bigserial('id', { mode: 'bigint' }).primaryKey(),
        calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('idx_usda_call_log_called_at').on(table.calledAt)],
);

/** A `usda_call_log` row as selected. */
export type UsdaCallLogRow = InferSelectModel<typeof usdaCallLog>;
/** A `usda_call_log` row for insert. */
export type NewUsdaCallLogRow = InferInsertModel<typeof usdaCallLog>;
