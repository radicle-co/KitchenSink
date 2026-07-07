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
    ],
);

/** An `account_erasure_jobs` row as selected. */
export type AccountErasureJobRow = InferSelectModel<typeof accountErasureJobs>;
/** An `account_erasure_jobs` row for insert. */
export type NewAccountErasureJobRow = InferInsertModel<typeof accountErasureJobs>;
