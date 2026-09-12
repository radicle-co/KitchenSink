/**
 * ADR-0040 — the erasure sweeper's backstop for `test_reset_jobs`, against a REAL PostgreSQL (as `recipe_app`).
 *
 * The unit suite pins which statements the sweeper issues; only the database can prove what they select and what the
 * give-up transition does to `idx_test_reset_jobs_active_user` (0045):
 *   - the claim returns exactly the in-flight rows untouched for the staleness window — never a fresh one (a second
 *     worker racing the first) and never a finished one (a purge re-run over the next test run's data);
 *   - `failed` FREES the partial unique index, which is the whole point of giving up: it releases the principal's
 *     write lock so a fresh reset can be requested;
 *   - the in-flight guard holds: a job that completed between the read and the update stays `completed`;
 *   - ⛔ a stale `running` job is handed back to `queued` before its message is re-sent (a delivery claims only
 *     `queued`, LOW-5), and the hand-back is guarded on the attempt the sweeper read, so a job a live delivery
 *     claimed in between is left alone.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { erasureQueueMessageKind } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import {
    abandonExhaustedTestResetJob,
    claimStaleTestResetJobs,
    requeueStaleTestResetJob,
    toTestPrincipalResetMessage,
} from '../../../src/handlers/erasureSweeper.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();

const STALE_USER = '01JTESTSWEEPSTA1E000000000';
const FRESH_USER = '01JTESTSWEEPFRESH00000000A';
const DONE_USER = '01JTESTSWEEPD0NE000000000A';

type JobRow = { readonly id: string; readonly status: string };

describe.skipIf(!hasTestDatabase)('erasure sweeper — stuck test-reset jobs on the real schema (ADR-0040)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(
            sql`DELETE FROM test_reset_jobs WHERE user_id IN (${STALE_USER}, ${FRESH_USER}, ${DONE_USER})`,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertJob(userId: string, status: string, idleMinutes: number): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO test_reset_jobs (user_id, status, attempts, created_at, updated_at)
            VALUES (${userId}, ${status}, 10, now() - interval '2 hours', now() - make_interval(mins => ${idleMinutes}))
            RETURNING id
        `);
        const id = result.rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the job insert returned no id');
        }

        return id;
    }

    async function statusOf(id: string): Promise<string | undefined> {
        const result = await db.execute<JobRow>(sql`SELECT id, status FROM test_reset_jobs WHERE id = ${id}`);

        return result.rows[0]?.status;
    }

    it('claims only in-flight jobs idle past the window, with a message the worker dispatches as a reset', async () => {
        const stale = await insertJob(STALE_USER, 'queued', 20);
        await insertJob(FRESH_USER, 'running', 1);
        await insertJob(DONE_USER, 'completed', 60);

        const claimed = (await claimStaleTestResetJobs(db)).filter((job) =>
            [STALE_USER, FRESH_USER, DONE_USER].includes(job.user_id),
        );

        expect(claimed.map((job) => job.id)).toEqual([stale]);
        expect(claimed[0]?.attempts).toBe(10);
        expect(claimed[0]?.age_seconds).toBeGreaterThanOrEqual(7200 - 5);

        const [job] = claimed;

        if (job === undefined) {
            throw new Error('unreachable: asserted above');
        }

        expect(erasureQueueMessageKind(toTestPrincipalResetMessage(job, new Date().toISOString()))).toBe(
            'testPrincipalReset',
        );
    });

    it('giving up FREES the active-job index, so a fresh reset for the same principal can be queued', async () => {
        const stuck = await insertJob(STALE_USER, 'running', 20);

        // While it is in flight, the partial unique index refuses a second active job — the write lock.
        const refused = await db
            .execute(sql`INSERT INTO test_reset_jobs (user_id) VALUES (${STALE_USER})`)
            .catch((error: unknown) => error);
        expect((refused as { cause?: { constraint?: string } }).cause?.constraint).toBe(
            'idx_test_reset_jobs_active_user',
        );

        const [job] = (await claimStaleTestResetJobs(db)).filter((row) => row.id === stuck);

        if (job === undefined) {
            throw new Error('test setup: the stuck job was not claimed');
        }

        await abandonExhaustedTestResetJob(db, job);

        expect(await statusOf(stuck)).toBe('failed');
        await expect(
            db.execute(sql`INSERT INTO test_reset_jobs (user_id) VALUES (${STALE_USER})`),
        ).resolves.toBeDefined();
    });

    it('never flips a job that completed between the read and the give-up', async () => {
        const racing = await insertJob(DONE_USER, 'running', 20);
        const [job] = (await claimStaleTestResetJobs(db)).filter((row) => row.id === racing);

        if (job === undefined) {
            throw new Error('test setup: the racing job was not claimed');
        }

        await db.execute(sql`UPDATE test_reset_jobs SET status = 'completed' WHERE id = ${racing}`);
        await abandonExhaustedTestResetJob(db, job);

        expect(await statusOf(racing)).toBe('completed');
    });

    it('⛔ hands a stale RUNNING job back to queued, so the re-sent message has something a delivery may claim', async () => {
        const dead = await insertJob(STALE_USER, 'running', 20);
        const [job] = (await claimStaleTestResetJobs(db)).filter((row) => row.id === dead);

        if (job === undefined) {
            throw new Error('test setup: the dead job was not read');
        }

        expect(await requeueStaleTestResetJob(db, job)).toBe(true);
        expect(await statusOf(dead)).toBe('queued');
    });

    it('⛔ leaves alone a job CLAIMED between the read and the hand-back, and reports it', async () => {
        const reclaimed = await insertJob(FRESH_USER, 'queued', 20);
        const [job] = (await claimStaleTestResetJobs(db)).filter((row) => row.id === reclaimed);

        if (job === undefined) {
            throw new Error('test setup: the job was not read');
        }

        // A live delivery claims it first — `running`, one attempt more than the sweeper read.
        await db.execute(
            sql`UPDATE test_reset_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ${reclaimed}`,
        );

        expect(await requeueStaleTestResetJob(db, job)).toBe(false);
        expect(await statusOf(reclaimed)).toBe('running');
    });

    it('never hands back a job that FINISHED between the read and the hand-back', async () => {
        const finished = await insertJob(DONE_USER, 'running', 20);
        const [job] = (await claimStaleTestResetJobs(db)).filter((row) => row.id === finished);

        if (job === undefined) {
            throw new Error('test setup: the job was not read');
        }

        await db.execute(sql`UPDATE test_reset_jobs SET status = 'completed' WHERE id = ${finished}`);

        expect(await requeueStaleTestResetJob(db, job)).toBe(false);
        expect(await statusOf(finished)).toBe('completed');
    });
});
