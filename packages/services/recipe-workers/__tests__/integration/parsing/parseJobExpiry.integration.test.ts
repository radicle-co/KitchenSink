/**
 * U9 — the parse-job TTL sweep against a real PostgreSQL (migration 0039).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the sweep is two claims about the DATABASE — that the expiry UPDATE
 * flips exactly the overdue jobs (never a live one, never an already-expired one twice), and that the
 * purge DELETE cascades to `recipe_parse_job_lines` (the pasted text — the retention bound is the point).
 * A unit test's fake pool proves neither.
 *
 * Runs against `DATABASE_URL` (a recipe database with migrations applied); skipped without it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { expireParseJobs, PARSE_JOB_PURGE_AFTER_DAYS } from '../../../src/parsing/parseJobExpiry.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

const OWNER = 'parse-expiry-test-owner';

describe.skipIf(!canRun)('expireParseJobs (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
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
