/**
 * ADR-0040 — the test-reset jobs data-access layer (migration 0045).
 *
 * @pattern Repository over `test_reset_jobs` — identity-blind like `ErasureJobsDal`, which it mirrors on purpose: the
 *   service supplies the verified user, and this answers about rows.
 *
 * **The one invariant that lives here, borrowed from `ErasureJobsDal`: the insert never reads first.** "Is a reset
 * already running for this principal?" is deferred to `idx_test_reset_jobs_active_user` through `ON CONFLICT … DO
 * NOTHING`, which Postgres evaluates atomically. The loser of a race gets zero rows back — a fact, not an error — and
 * the service turns that into the idempotent `202`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DrizzleProvider, type RecipeDrizzle } from '../../database/database.module.js';
import { ACTIVE_TEST_RESET_JOB_STATUSES, testResetJobs } from '../../database/schema/testPrincipals.js';
import {
    activeTestResetJobStatusSchema,
    testResetJobStatusSchema,
    type ActiveTestResetJobStatus,
    type TestResetJobStatus,
} from '../testReset.schema.js';

/** An in-flight reset job, narrowed to what the `202` needs. */
export interface ActiveTestResetJob {
    readonly id: string;
    readonly status: ActiveTestResetJobStatus;
}

/** One of the principal's own reset jobs, narrowed to what the status query answers. */
export interface TestResetJob {
    readonly id: string;
    readonly status: TestResetJobStatus;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}

/**
 * The `idx_test_reset_jobs_active_user` predicate, restated as the `ON CONFLICT` target's qualifier — Postgres only
 * matches a PARTIAL index when the statement repeats its predicate. Verbatim from migration 0045.
 */
const ACTIVE_USER_INDEX_PREDICATE = sql`${testResetJobs.status} IN ('queued', 'running')`;

@Injectable()
export class TestResetJobsDal {
    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /**
     * Insert a fresh `queued` job for the principal, deferring "already running?" to the partial unique index.
     *
     * @param userId - The verified app-user ULID of a registered test principal.
     * @returns The new job's id, or `undefined` when a job is already in flight (the conflict).
     * @sideEffect Inserts into `test_reset_jobs`.
     */
    public async insertQueuedJob(userId: string): Promise<string | undefined> {
        const inserted = await this.db
            .insert(testResetJobs)
            .values({ userId })
            .onConflictDoNothing({ target: testResetJobs.userId, where: ACTIVE_USER_INDEX_PREDICATE })
            .returning({ id: testResetJobs.id });

        return inserted[0]?.id;
    }

    /**
     * Read the principal's in-flight job, if any. At most one exists — the partial unique index guarantees it.
     *
     * @param userId - The app-user ULID.
     * @returns The in-flight job, or `undefined`.
     * @throws {Error} When a row escapes the status filter — a broken query contract, surfaced rather than coerced.
     * @sideEffect Reads `test_reset_jobs`.
     */
    public async findActiveJob(userId: string): Promise<ActiveTestResetJob | undefined> {
        const rows = await this.db
            .select({ id: testResetJobs.id, status: testResetJobs.status })
            .from(testResetJobs)
            .where(
                and(
                    eq(testResetJobs.userId, userId),
                    inArray(testResetJobs.status, [...ACTIVE_TEST_RESET_JOB_STATUSES]),
                ),
            )
            .limit(1);
        const row = rows[0];

        if (row === undefined) {
            return undefined;
        }

        const status = activeTestResetJobStatusSchema.safeParse(row.status);

        if (!status.success) {
            throw new Error(`test_reset_jobs row ${row.id} escaped the in-flight filter with status ${row.status}`);
        }

        return { id: row.id, status: status.data };
    }

    /**
     * Read ONE of the principal's own reset jobs.
     *
     * ⛔ Scoped by `user_id` in the `WHERE` clause, not checked after the read: a job id belonging to another
     * principal matches no row, and zero rows IS the `404`.
     *
     * @param userId - The verified app-user ULID.
     * @param jobId - The job id from the path (already a UUID — the service parses it first).
     * @returns The job, or `undefined` when it is not this principal's.
     * @throws {Error} When a stored status is outside the contract's four.
     * @sideEffect Reads `test_reset_jobs`.
     */
    public async findOwnJob(userId: string, jobId: string): Promise<TestResetJob | undefined> {
        const rows = await this.db
            .select({
                id: testResetJobs.id,
                status: testResetJobs.status,
                createdAt: testResetJobs.createdAt,
                updatedAt: testResetJobs.updatedAt,
            })
            .from(testResetJobs)
            .where(and(eq(testResetJobs.id, jobId), eq(testResetJobs.userId, userId)))
            .limit(1);
        const row = rows[0];

        if (row === undefined) {
            return undefined;
        }

        const status = testResetJobStatusSchema.safeParse(row.status);

        if (!status.success) {
            throw new Error(`test_reset_jobs row ${row.id} carries an unknown status ${row.status}`);
        }

        return { id: row.id, status: status.data, createdAt: row.createdAt, updatedAt: row.updatedAt };
    }
}
