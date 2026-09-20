/**
 * U9 — the parse-job TTL sweep against a real PostgreSQL (migration 0039).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the sweep is two claims about the DATABASE — that the expiry UPDATE
 * flips exactly the overdue jobs (never a live one, never an already-expired one twice), and that the
 * purge DELETE cascades to `recipe_parse_job_lines` (the pasted text — the retention bound is the point).
 * A unit test's fake pool proves neither.
 *
 * Runs against the role-split fixture (`../roleDb.js`) as `recipe_app`; skipped when no admin server is
 * configured.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    expireParseJobs,
    oldestRunningParseJobAgeSeconds,
    PARSE_JOB_PURGE_AFTER_DAYS,
} from '../../../src/parsing/parseJobExpiry.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

/** The subject connects as `recipe_app` (ADR-0039): DML and nothing else, which is what the workers hold. */
const roleDb = recipeWorkersDb();
const canRun = hasTestDatabase;

const OWNER = 'parse-expiry-test-owner';

describe.skipIf(!canRun)('expireParseJobs (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Seed one job (+1 line) whose `expires_at` sits `hoursAgo` in the past (negative = future). */
    async function seedJob(status: string, hoursAgo: number): Promise<string> {
        const result = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, status, expires_at)
             VALUES ($1, $2, now() - ($3 || ' hours')::interval)
             RETURNING id`,
            [OWNER, status, String(hoursAgo)],
        );
        const id = (result.rows[0] as { id: string }).id;

        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
             VALUES ($1, 0, 'the pasted text', $2)`,
            [id, 'c'.repeat(64)],
        );

        return id;
    }

    async function statusOf(id: string): Promise<string | undefined> {
        const result = await pool.query('SELECT status FROM recipe_parse_jobs WHERE id = $1', [id]);

        return (result.rows[0] as { status: string } | undefined)?.status;
    }

    it('expires every overdue job regardless of status, and leaves live jobs alone', async () => {
        const overdueRunning = await seedJob('running', 1);
        const overdueComplete = await seedJob('complete', 1);
        const live = await seedJob('running', -1);

        await expireParseJobs(pool);

        expect(await statusOf(overdueRunning)).toBe('expired');
        expect(await statusOf(overdueComplete)).toBe('expired');
        expect(await statusOf(live)).toBe('running');
    });

    it('purges a job past the purge horizon, CASCADING to its lines (the pasted text)', async () => {
        const purgeable = await seedJob('expired', (PARSE_JOB_PURGE_AFTER_DAYS + 1) * 24);
        const merelyExpired = await seedJob('expired', 1);

        await expireParseJobs(pool);

        expect(await statusOf(purgeable)).toBeUndefined();
        expect(await statusOf(merelyExpired)).toBe('expired');

        const lines = await pool.query('SELECT 1 FROM recipe_parse_job_lines WHERE job_id = $1', [purgeable]);

        expect(lines.rows).toHaveLength(0);
    });
});

/**
 * ⛔ THE STALL DETECTOR, AND WHY IT IS AN INTEGRATION TEST RATHER THAN A UNIT ONE.
 *
 * `PARSE_JOB_TTL_HOURS = 24`. A job whose lines never land stays non-terminal until the sweep above
 * discards it a day later — no error, nothing for the cook to click, and no signal to anyone. Every claim
 * this query makes is a claim about the DATABASE: that `running` is the non-terminal status (the CHECK
 * constraint admits exactly `running | partial | complete | expired`), that `partial` is EXCLUDED, and that
 * an empty table answers `0` rather than `NULL`. A fake pool proves none of them, and the `NULL` case is
 * the one that matters most — a `NULL` reaching `emitMetric` publishes a metric CloudWatch discards, which
 * is a detector that reports nothing and looks fine.
 *
 * ⛔ `partial` IS DELIBERATELY NOT STALLED. It is the aggregate a job reaches when a line is
 * `failed_retryable` — the resting state `POST :id/retry` exists for — so the system is waiting on a
 * HUMAN, not failing to answer. Counting it would make the alarm fire on the product working as designed,
 * which is how an alarm becomes noise and then becomes ignored.
 */
describe.skipIf(!canRun)('oldestRunningParseJobAgeSeconds (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Seed a job with an explicit `created_at` age and a live `expires_at`. */
    async function seedAged(status: string, ageSeconds: number): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, status, created_at, expires_at)
             VALUES ($1, $2, now() - ($3 || ' seconds')::interval, now() + interval '1 hour')`,
            [OWNER, status, String(ageSeconds)],
        );
    }

    it('answers 0 — never NULL — when nothing is running', async () => {
        await expect(oldestRunningParseJobAgeSeconds(pool)).resolves.toBe(0);
    });

    it('answers the age of the OLDEST running job', async () => {
        await seedAged('running', 120);
        await seedAged('running', 7200);

        const age = await oldestRunningParseJobAgeSeconds(pool);

        expect(age).toBeGreaterThanOrEqual(7200);
        expect(age).toBeLessThan(7260);
    });

    it('⛔ ignores partial, complete and expired — only `running` means the system still owes an answer', async () => {
        await seedAged('partial', 9000);
        await seedAged('complete', 9000);
        await seedAged('expired', 9000);

        await expect(oldestRunningParseJobAgeSeconds(pool)).resolves.toBe(0);
    });
});
