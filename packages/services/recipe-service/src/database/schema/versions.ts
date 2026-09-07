/**
 * Drizzle definitions for recipe versioning: `recipe_versions` (T013 — last 10 kept in DB, all pushed
 * to S3, FR-007b) and `recipe_version_pending_archives` (T121 — tracks version snapshots written to
 * PostgreSQL but not yet archived to S3, FR-007b-i). Mirrors data-model.md EXACTLY.
 *
 * D2 (no local `users` table): `created_by` stores the app-user ULID (from the token claim) directly
 * as `VARCHAR(255) NOT NULL` — no FK, no user replication.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
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
import type { RecipeVersionArchiveStatus } from '@kitchensink/recipe-core';

import { recipes } from './recipes.js';

/**
 * Archive lifecycle status (FR-007b-i). Identical domain to recipe-core's authoritative
 * {@link RecipeVersionArchiveStatus}, so the array is tied with `satisfies` (S-R5) to fail the build on
 * drift. `PendingArchiveStatus` stays its own name (no collision with recipe-core) since every existing
 * consumer imports it from this file.
 */
export const PENDING_ARCHIVE_STATUSES = [
    'pending',
    'in_flight',
    'failed',
    'dlq',
] as const satisfies readonly RecipeVersionArchiveStatus[];

/** A pending-archive status value (identical domain to {@link RecipeVersionArchiveStatus}). */
export type PendingArchiveStatus = (typeof PENDING_ARCHIVE_STATUSES)[number];

// ── recipe_versions: snapshot history (last 10 in DB, all in S3) ──────────────────────────────────

/**
 * ⚠️ THE PHYSICAL TABLE STILL HAS A `device_label` COLUMN THAT IS DELIBERATELY NOT DECLARED HERE.
 *
 * The owner ruled on **2026-08-26** that device attribution comes out — *"I don't care what device they
 * were on when they edited something"* — so `0014_version_device_label.sql`'s column is now read by
 * nothing. Its `DROP` is deferred to a LATER release, which is ADR-0022's standing EXPAND-FIRST
 * precondition and not an oversight: *"a contracting migration ships a release LATER than the code that
 * stopped reading the column."* The in-stack Trigger applies migrations BEFORE the new tasks serve, so
 * dropping it in the same release would leave the PREVIOUS image issuing `SELECT`s naming a column that no
 * longer exists — and both version-history reads (`versions.dal.ts`) and the 409's conflict-enrichment read
 * (`recipes.dal.ts`) are bare `.select()`s over this table, so they would raise `42703` as a user-visible
 * 500, while `recordSnapshot`'s INSERT — which is best-effort and SWALLOWS its error — would drop version
 * rows permanently and silently. Deferring costs nothing: every row's `device_label` is already NULL.
 *
 * Removing the field from this definition is what makes the deferral SAFE. Drizzle only ever names the
 * columns declared here, so the undeclared, nullable column is simply never selected or inserted.
 *
 * ⛔ Do NOT "restore" the column here to make the definition match the database. The follow-up migration is
 * recorded in `specs/001-commise-recipe-app/change-requests/CR-004-version-compare-and-conflict-diff.md`
 * (its 2026-08-26 amendment) and in `0014_version_device_label.sql`'s own header.
 */
export const recipeVersions = pgTable(
    'recipe_versions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        versionNumber: integer('version_number').notNull(),
        // Full recipe snapshot at this version.
        snapshot: jsonb('snapshot').notNull(),
        // Enables 3-way merge conflict detection.
        baseVersion: integer('base_version'),
        // S3 archive key (all versions). NULL = DB-only so far; still fully usable for restore.
        s3Key: text('s3_key'),
        // App-user ULID (from token claim); no FK, no local users table (D2).
        createdBy: varchar('created_by', { length: 255 }).notNull(),
        changeSummary: text('change_summary'),
        // The version editor's denormalized display-name (W8-a.2 / decision 6). A mutable COLUMN, NOT a
        // snapshot field (a handle frozen in the immutable snapshot could never be corrected by rename-sync).
        // NULLABLE; kept current by the handle-sync consumer's fan-out. The editor is `created_by` (the ULID).
        editorHandle: text('editor_handle'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('recipe_versions_recipe_version_unique').on(table.recipeId, table.versionNumber),
        index('idx_recipe_versions_recipe_id').on(table.recipeId),
        // GIN index on snapshot for querying version content.
        index('idx_recipe_versions_snapshot').using('gin', table.snapshot),
    ],
);

/** A `recipe_versions` row as selected. */
export type RecipeVersionRow = InferSelectModel<typeof recipeVersions>;
/** A `recipe_versions` row for insert. */
export type NewRecipeVersionRow = InferInsertModel<typeof recipeVersions>;

// ── recipe_version_pending_archives: S3-archive outbox (FR-007b-i) ────────────────────────────────

export const recipeVersionPendingArchives = pgTable(
    'recipe_version_pending_archives',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeVersionId: uuid('recipe_version_id')
            .notNull()
            .references(() => recipeVersions.id, { onDelete: 'cascade' }),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        versionNumber: integer('version_number').notNull(),

        // Retry-bookkeeping columns RESERVED, not live: the shipped design (T130) drives retries via SQS
        // redelivery and exhaustion via the DLQ, so a failed archive THROWS and is re-driven by SQS — the
        // service/worker never write `'failed'`/`'in_flight'`/`'dlq'`, never increment `attempts`, never set
        // `last_error`, and never reschedule `next_attempt_at`. Every row stays `status = 'pending'`,
        // `attempts = 0` for its whole life (enqueue → worker archives → DELETE). Kept for a possible future
        // in-DB retry policy; do NOT assume they reflect real attempt state today.
        status: text('status').notNull().default('pending'),
        attempts: integer('attempts').notNull().default(0),
        lastError: text('last_error'),
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),

        sqsMessageId: text('sqs_message_id'),
        sqsReceipt: text('sqs_receipt'),

        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('pending_archives_status_check', sql`${table.status} IN ('pending', 'in_flight', 'failed', 'dlq')`),
        uniqueIndex('recipe_version_pending_archives_version_unique').on(table.recipeVersionId),
        index('idx_pending_archives_status_next')
            .on(table.status, table.nextAttemptAt)
            .where(sql`${table.status} IN ('pending', 'failed')`),
        index('idx_pending_archives_recipe_id').on(table.recipeId),
    ],
);

/** A `recipe_version_pending_archives` row as selected. */
export type RecipeVersionPendingArchiveRow = InferSelectModel<typeof recipeVersionPendingArchives>;
/** A `recipe_version_pending_archives` row for insert. */
export type NewRecipeVersionPendingArchiveRow = InferInsertModel<typeof recipeVersionPendingArchives>;
