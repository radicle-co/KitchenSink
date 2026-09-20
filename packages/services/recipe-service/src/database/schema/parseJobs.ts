/**
 * Drizzle mirrors for the parse-job substrate (plan U8/U9, migration 0039).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0039_recipe_parse_jobs.sql` is the SOURCE OF TRUTH
 * (repo convention); its header carries the design — async jobs, digest-guarded landings (R17),
 * proposals that bind nothing (R19), owner-scoped and erased with their owner.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** The job-level lifecycle, mirrored from the SQL CHECK. */
export const PARSE_JOB_STATUSES = ['running', 'partial', 'complete', 'expired'] as const;

/** The per-line lifecycle, mirrored from the SQL CHECK. */
export const PARSE_JOB_LINE_STATUSES = ['pending', 'parsed', 'unparseable', 'failed_retryable'] as const;

export const recipeParseJobs = pgTable(
    'recipe_parse_jobs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ownerId: varchar('owner_id', { length: 255 }).notNull(),
        status: text('status').notNull().default('running'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
        check('recipe_parse_jobs_status_check', sql`${table.status} IN ('running', 'partial', 'complete', 'expired')`),
        index('recipe_parse_jobs_owner_idx').on(table.ownerId, table.createdAt),
        index('recipe_parse_jobs_expiry_idx').on(table.expiresAt),
    ],
);

export const recipeParseJobLines = pgTable(
    'recipe_parse_job_lines',
    {
        jobId: uuid('job_id')
            .notNull()
            .references(() => recipeParseJobs.id, { onDelete: 'cascade' }),
        lineIndex: integer('line_index').notNull(),
        sourceLine: text('source_line').notNull(),
        /** R17: the stored phrase hash landings are guarded on. */
        lineDigest: text('line_digest').notNull(),
        status: text('status').notNull().default('pending'),
        /** The merged ParsedLine projection — proposals only (R19). */
        proposal: jsonb('proposal'),
        llmAttempts: integer('llm_attempts'),
        /**
         * U6: deliveries CLAIMED for this line — not failures. A line redelivered without landing used to be
         * invisible until its job's TTL swept the whole import; past the allowance the handler makes it
         * `failed_retryable`, which is the population the retry endpoint re-drives.
         *
         * ⚠️ Nullable by EXPAND-FIRST (ADR-0035), not by accident: rows written before migration 0046 carry
         * NULL, and every reader `COALESCE`s to 0 rather than assuming the backfill that deliberately did
         * not happen.
         */
        attempts: integer('attempts'),
        /**
         * U6: when the last delivery claimed this line — the claim LEASE. A claim requires this to be NULL
         * or older than the handler's own timeout, so a duplicate delivered while the first attempt is still
         * running is refused while a genuine redelivery (only made after the queue's longer visibility
         * timeout) is admitted.
         */
        lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
        /** U6: why a line became `failed_retryable`, so the retry surface can say what went wrong. */
        failureCode: text('failure_code'),
        /**
         * When this line's answer was COPIED from a previously landed line instead of landed by the worker
         * (migration 0048). NULL means the worker landed it.
         *
         * ⛔ THE ANTI-LAUNDERING PREDICATE, not bookkeeping. `landedAt` is read from `updated_at`, and a
         * copied row's `updated_at` is its INSERT time — so without `copied_at IS NULL` in the candidate
         * predicate, a chain of copies would present an ever-refreshing landing time and defeat BOTH the
         * recency window and the corrections watermark. Its second job is that it is the only way
         * copy-forward's hit rate can be observed at all.
         *
         * ⚠️ Nullable by EXPAND-FIRST (ADR-0035): rows written before 0048 carry NULL, which reads correctly
         * as "landed, not copied" — the value the predicate wants for every pre-existing row.
         */
        copiedAt: timestamp('copied_at', { withTimezone: true }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.jobId, table.lineIndex] }),
        check(
            'recipe_parse_job_lines_status_check',
            sql`${table.status} IN ('pending', 'parsed', 'unparseable', 'failed_retryable')`,
        ),
        // Serves the copy-forward candidate lookup. Partial on the query's own predicate — only a
        // worker-landed line carrying a proposal can ever be a source.
        index('recipe_parse_job_lines_copy_forward_idx')
            .on(table.lineDigest, table.updatedAt.desc())
            .where(sql`${table.proposal} IS NOT NULL AND ${table.copiedAt} IS NULL`),
    ],
);

export type ParseJobStatus = (typeof PARSE_JOB_STATUSES)[number];
export type ParseJobLineStatus = (typeof PARSE_JOB_LINE_STATUSES)[number];
export type RecipeParseJobRow = InferSelectModel<typeof recipeParseJobs>;
export type NewRecipeParseJobRow = InferInsertModel<typeof recipeParseJobs>;
export type RecipeParseJobLineRow = InferSelectModel<typeof recipeParseJobLines>;
export type NewRecipeParseJobLineRow = InferInsertModel<typeof recipeParseJobLines>;
