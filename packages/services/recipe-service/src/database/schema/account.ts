/**
 * Drizzle definition for `account_erasure_jobs` (T122). Tracks each `POST /v1/account/erasure` enqueue
 * so the endpoint is idempotent per C-007 (NOT a 409). This table is the SINGLE authoritative source
 * for the erasure job status enum. Mirrors data-model.md EXACTLY.
 *
 * D2 (no local `users` table): `owner_id` stores the app-user ULID (from token claim) of the user whose
 * data is being erased directly as `VARCHAR(255) NOT NULL` — no FK, no user replication.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/** Canonical erasure job status enum (authoritative source for every artifact). */
export const ERASURE_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;

/** An erasure job status value. */
export type ErasureJobStatus = (typeof ERASURE_JOB_STATUSES)[number];

/**
 * The statuses that make a job "in flight". This is ONE piece of knowledge wearing three hats, so it is
 * named once here rather than re-typed at each use:
 *
 *  1. the predicate of the `idx_erasure_jobs_active_owner` partial unique index below (which is what
 *     makes `POST /v1/account/erasure` idempotent),
 *  2. the set `ErasureJobsDal.findActiveJob` reads, and
 *  3. the `202` response's `status` enum in `api.openapi.yaml`.
 *
 * `satisfies readonly ErasureJobStatus[]` ties it to the authoritative {@link ERASURE_JOB_STATUSES}: a
 * status renamed there fails the build here instead of silently narrowing to nothing at runtime.
 */
export const ACTIVE_ERASURE_JOB_STATUSES = ['queued', 'running'] as const satisfies readonly ErasureJobStatus[];

/** A status of an in-flight (`queued`/`running`) erasure job — the `202` response's `status` enum. */
export type ActiveErasureJobStatus = (typeof ACTIVE_ERASURE_JOB_STATUSES)[number];

export const accountErasureJobs = pgTable(
    'account_erasure_jobs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        // App-user ULID (from token claim) of the user whose data is being erased. No FK, no users table.
        ownerId: varchar('owner_id', { length: 255 }).notNull(),
        status: text('status').notNull().default('queued'),
        attempts: integer('attempts').notNull().default(0),
        lastError: text('last_error'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('erasure_jobs_status_check', sql`${table.status} IN ('queued', 'running', 'completed', 'failed')`),
        // At most one in-flight job per user: a duplicate POST while a job is 'queued'/'running' collides
        // here, so the endpoint returns 202 with the existing job id (no second enqueue).
        uniqueIndex('idx_erasure_jobs_active_owner')
            .on(table.ownerId)
            .where(sql`${table.status} IN ('queued', 'running')`),
        index('idx_erasure_jobs_status')
            .on(table.status)
            .where(sql`${table.status} IN ('queued', 'running')`),
        // Plain (non-partial) owner index. The resurrection-race guard runs `SELECT EXISTS(... WHERE
        // owner_id = $1)` with NO status filter, so it cannot use the partial idx_erasure_jobs_active_owner
        // (whose predicate excludes completed/failed rows). Without this index that EXISTS is a Seq Scan
        // that degrades as the table grows (0010 migration / FOLLOW-UP).
        index('idx_erasure_jobs_owner_id').on(table.ownerId),
    ],
);

/** An `account_erasure_jobs` row as selected. */
export type AccountErasureJobRow = InferSelectModel<typeof accountErasureJobs>;
/** An `account_erasure_jobs` row for insert. */
export type NewAccountErasureJobRow = InferInsertModel<typeof accountErasureJobs>;
