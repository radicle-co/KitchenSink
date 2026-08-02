/**
 * Drizzle definition for `account_erasure_jobs` (T122). Tracks each `POST /api/v1/account/erasure` enqueue
 * so the endpoint is idempotent per C-007 (NOT a 409). This table is the SINGLE authoritative source
 * for the erasure job status enum. Mirrors data-model.md EXACTLY.
 *
 * D2 (no local `users` table): `owner_id` stores the app-user ULID (from token claim) of the user whose
 * data is being erased directly as `VARCHAR(255) NOT NULL` — no FK, no user replication.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { ERASURE_TRIGGER_SOURCES } from '@kitchensink/recipe-core';
import {
    check,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';

/** Canonical erasure job status enum (authoritative source for every artifact). */
export const ERASURE_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;

/** An erasure job status value. */
export type ErasureJobStatus = (typeof ERASURE_JOB_STATUSES)[number];

/**
 * The statuses that make a job "in flight". This is ONE piece of knowledge wearing three hats, so it is
 * named once here rather than re-typed at each use:
 *
 *  1. the predicate of the `idx_erasure_jobs_active_owner` partial unique index below (which is what
 *     makes `POST /api/v1/account/erasure` idempotent),
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

        // The per-recipe DONATE election (CR-002 / U3b): the recipe ids the owner elected to PUBLISH
        // (donate) rather than remove. The DURABLE SOURCE OF TRUTH for the election — the worker reads it
        // from the claimed row, not from the SQS message (which is a derived carrier), so the sweeper can
        // reconstruct a lost message from the row and a stale/forged message can never redirect the
        // election. NULL / [] ⇒ donate nothing ⇒ every owner-only recipe is removed (the default).
        publishRecipeIds: jsonb('publish_recipe_ids').$type<string[]>(),

        // The captured REMOVED-recipe id set (CR-002 / U3a — crash-convergence). The owner-only (non
        // truly-public) recipes this erasure removes, written INSIDE the same transaction that deletes
        // them. The scoped S3 sweep is driven per-removed-recipe (not by the owner prefix, which would
        // delete kept media), so the ids must survive the row delete: after the DELETE they are
        // unrecoverable from `recipes`, and an SQS redelivery re-claims the still-`running` job and reads
        // this column to finish the sweep. Written ONCE (guarded `IS NULL`), so a replay never clobbers it.
        removedRecipeIds: jsonb('removed_recipe_ids').$type<string[]>(),

        // ── R8 audit fields (CR-002 / U4a — migration 0018) ────────────────────────────────────────────
        // WHO/WHAT triggered this erasure job and WHEN it was confirmed, recorded independently of the
        // mutable `status` column so the audit survives a status transition.
        //
        // trigger_source — 'user' (owner via the confirmation-gated POST /api/v1/account/erasure) or 'service'
        // (the deletion-worker's verified service principal via the internal route, which skips the phrase
        // BECAUSE the signed single-target token is the authorization; KTD-2). DEFAULT 'user' matches every
        // historical row (all predate the service path).
        triggerSource: text('trigger_source')
            .notNull()
            .default('user')
            .$type<(typeof ERASURE_TRIGGER_SOURCES)[number]>(),
        // The principal that triggered it: the owner's own ULID for a user erasure, or the signed token's
        // machine actor label (e.g. the deletion-worker) for a service erasure. Nullable only for the
        // pre-0018 backfilled rows; the application always writes it on new rows.
        actor: varchar('actor', { length: 255 }),
        // When the erasure was CONFIRMED — the phrase validated (user path) or the token verified (service
        // path). Distinct from created_at in intent (it asserts a deliberate confirmation happened), even
        // though the two coincide in the current single-step flow.
        confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('erasure_jobs_status_check', sql`${table.status} IN ('queued', 'running', 'completed', 'failed')`),
        // trigger_source is a two-value audit enum; the CHECK is the DB-level guard mirroring
        // ERASURE_TRIGGER_SOURCES (the authoritative union in @kitchensink/recipe-core).
        check('erasure_jobs_trigger_source_check', sql`${table.triggerSource} IN ('user', 'service')`),
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
