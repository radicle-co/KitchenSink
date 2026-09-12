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
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.jobId, table.lineIndex] }),
        check(
            'recipe_parse_job_lines_status_check',
            sql`${table.status} IN ('pending', 'parsed', 'unparseable', 'failed_retryable')`,
        ),
    ],
);

export type ParseJobStatus = (typeof PARSE_JOB_STATUSES)[number];
export type ParseJobLineStatus = (typeof PARSE_JOB_LINE_STATUSES)[number];
export type RecipeParseJobRow = InferSelectModel<typeof recipeParseJobs>;
export type NewRecipeParseJobRow = InferInsertModel<typeof recipeParseJobs>;
export type RecipeParseJobLineRow = InferSelectModel<typeof recipeParseJobLines>;
export type NewRecipeParseJobLineRow = InferInsertModel<typeof recipeParseJobLines>;
