/**
 * `test_principals` + `test_reset_jobs` (migrations 0044, 0045 — ADR-0040).
 *
 * `test_principals` is a READ MODEL of which app-user ULIDs have presented the signed test-principal claim, upserted
 * by `AuthMiddleware`; the self-purge requires the claim AND a row here. `test_reset_jobs` is the durable record of
 * one self-purge, claimed by the account-erasure worker exactly as `account_erasure_jobs` is.
 *
 * See the migrations for the reasoning; this file only models what they create.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import type { ActiveTestResetJobStatus, TestResetJobStatus } from '../../account/testReset.schema.js';

/** Every `test_reset_jobs.status` value — typed FROM the contract, so a divergence fails the build here. */
export const TEST_RESET_JOB_STATUSES = [
    'queued',
    'running',
    'completed',
    'failed',
] as const satisfies readonly TestResetJobStatus[];

/** The in-flight subset — the predicate of `idx_test_reset_jobs_active_user`. */
export const ACTIVE_TEST_RESET_JOB_STATUSES = [
    'queued',
    'running',
] as const satisfies readonly ActiveTestResetJobStatus[];

export const testPrincipals = pgTable('test_principals', {
    userId: varchar('user_id', { length: 255 }).primaryKey(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
});

export const testResetJobs = pgTable(
    'test_reset_jobs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: varchar('user_id', { length: 255 }).notNull(),
        status: text('status').notNull().default('queued').$type<TestResetJobStatus>(),
        attempts: integer('attempts').notNull().default(0),
        lastError: text('last_error'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('test_reset_jobs_status_check', sql`${table.status} IN ('queued', 'running', 'completed', 'failed')`),
        uniqueIndex('idx_test_reset_jobs_active_user')
            .on(table.userId)
            .where(sql`${table.status} IN ('queued', 'running')`),
    ],
);

export type TestPrincipalRow = InferSelectModel<typeof testPrincipals>;
export type NewTestPrincipalRow = InferInsertModel<typeof testPrincipals>;
export type TestResetJobRow = InferSelectModel<typeof testResetJobs>;
export type NewTestResetJobRow = InferInsertModel<typeof testResetJobs>;
