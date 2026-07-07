/**
 * Drizzle table definitions for the operational layer (feature 003, plan.md §2 "Operational tables"):
 * the demand-weighted Postgres-as-queue, the distinct-requester demand set, the per-source rolling
 * 60-min call ledger, and per-source sync metadata. All keyed on the food `id` (FR-IDN-3) — no
 * source-native key, no quota tables (`user_fetch_quota`/`global_fetch_quota` are deliberately absent;
 * fairness is by demotion at drain time).
 *
 * `fetch_queue.status` and `food_sources.fetch_state` (in `./food.ts`) are operational text+CHECK
 * columns, deliberately NOT `pgEnum` (DB-7): their value sets are operational mechanics that may need
 * cheap in-place evolution; the CHECK still constrains the set.
 *
 * The hand-authored ordered SQL in `../migrations/0000_food_schema.sql` is the SOURCE OF TRUTH.
 *
 * @implements FR-014 FR-015 FR-016 FR-018 FR-019 FR-020 FR-043 FR-044 FR-IDN-3
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { bigserial, check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { food, foodSourceEnum } from './food.js';

// ── fetch_queue: demand-weighted Postgres-as-queue, keyed on food id (FR-014/FR-015) ─────────────

/**
 * Single durable demand-weighted queue (FR-014/FR-015), one row per food `id` (the `ON CONFLICT`
 * dedup target). `request_count` is the capped distinct-requester count (FR-044). `leased_at` is the
 * worker-lease stamp — the reaper reverts `in_flight` rows whose `leased_at < now() - lease-timeout`
 * back to `pending` (D-LEASE; reject `lease_expires_at` / reusing `last_requested`). `status` is an
 * operational text+CHECK column (DB-7).
 */
export const fetchQueue = pgTable(
    'fetch_queue',
    {
        foodId: text('food_id')
            .primaryKey()
            .references(() => food.id, { onDelete: 'cascade' }),
        requestCount: integer('request_count').notNull().default(1),
        firstRequested: timestamp('first_requested', { withTimezone: true }).notNull().defaultNow(),
        lastRequested: timestamp('last_requested', { withTimezone: true }).notNull().defaultNow(),
        status: text('status').notNull().default('pending'),
        attempts: integer('attempts').notNull().default(0),
        lastError: text('last_error'),
        fetchedAt: timestamp('fetched_at', { withTimezone: true }),
        leasedAt: timestamp('leased_at', { withTimezone: true }),
    },
    (table) => [
        check('fetch_queue_status_check', sql`${table.status} IN ('pending', 'in_flight', 'tombstone')`),
        // FR-015 demand-weighted partial index — the worker's drain ORDER BY.
        index('idx_fetch_queue_priority')
            .on(sql`${table.requestCount} DESC`, sql`${table.firstRequested} ASC`)
            .where(sql`${table.status} = 'pending'`),
        // FR-018 reaper / leaseNext in_flight-reclaim access path (DB-8) — keeps them off a seq scan.
        index('idx_fetch_queue_inflight_lease')
            .on(table.leasedAt)
            .where(sql`${table.status} = 'in_flight'`),
    ],
);

/** A `fetch_queue` row as selected. */
export type FetchQueueRow = InferSelectModel<typeof fetchQueue>;
/** A `fetch_queue` row for insert. */
export type NewFetchQueueRow = InferInsertModel<typeof fetchQueue>;

// ── fetch_requesters: distinct-requester demand + per-sub pending count + WS targeting ───────────

/**
 * Distinct-requester demand (FR-044) + per-`sub` pending-count source for fairness-by-demotion
 * (FR-043) and WebSocket targeting. The `(food_id, sub)` PK structurally caps each `sub` to one row
 * per food (so a `sub` cannot inflate priority by repeating). Pruned when the food leaves the queue
 * (DSN-10).
 */
export const fetchRequesters = pgTable(
    'fetch_requesters',
    {
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        sub: text('sub').notNull(),
        requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.foodId, table.sub] }), index('idx_fetch_requesters_sub').on(table.sub)],
);

/** A `fetch_requesters` row as selected. */
export type FetchRequesterRow = InferSelectModel<typeof fetchRequesters>;
/** A `fetch_requesters` row for insert. */
export type NewFetchRequesterRow = InferInsertModel<typeof fetchRequesters>;

// ── source_call_log: per-source rolling 60-min window (FR-019/FR-020) ────────────────────────────

/**
 * Per-source rolling-60-min call ledger (FR-019/FR-020). One timestamped row per outbound source
 * call; the trailing-60-min count is `COUNT(*) WHERE source = $1 AND called_at > now() - interval '60
 * minutes'`. Rows older than the window are pruned on a periodic sweep. Generalizes the removed
 * USDA-only `usda_call_log` to per-source; there is no token-bucket `rate_limiter_state`.
 */
export const sourceCallLog = pgTable(
    'source_call_log',
    {
        id: bigserial('id', { mode: 'bigint' }).primaryKey(),
        source: foodSourceEnum('source').notNull(),
        calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('idx_source_call_log_source_called_at').on(table.source, table.calledAt)],
);

/** A `source_call_log` row as selected. */
export type SourceCallLogRow = InferSelectModel<typeof sourceCallLog>;
/** A `source_call_log` row for insert. */
export type NewSourceCallLogRow = InferInsertModel<typeof sourceCallLog>;

// ── source_sync_metadata: source-neutral sync tracking (FR-IDN-3) ────────────────────────────────

/**
 * Source-neutral sync tracking (FR-IDN-3). One row per source (the `source` enum is the PK) — replaces
 * the removed `usda_sync_metadata` singleton; no USDA-named columns in the canonical schema.
 */
export const sourceSyncMetadata = pgTable('source_sync_metadata', {
    source: foodSourceEnum('source').primaryKey(),
    lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
    lastIncrementalAt: timestamp('last_incremental_at', { withTimezone: true }),
    sourceVersion: text('source_version'),
});

/** A `source_sync_metadata` row as selected. */
export type SourceSyncMetadataRow = InferSelectModel<typeof sourceSyncMetadata>;
/** A `source_sync_metadata` row for insert. */
export type NewSourceSyncMetadataRow = InferInsertModel<typeof sourceSyncMetadata>;
