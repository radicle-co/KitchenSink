/**
 * Withdrawing parse-job lines against the REAL app and database (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a; plan
 * 2026-10-15-011, open question 8; migration 0054).
 *
 * What only this tier can prove:
 *
 *  - migration 0054 applied: the status CHECK admits `withdrawn` and still refuses an invented status (a unit test
 *    cannot observe a migration that did not apply);
 *  - owner scoping is a WHERE clause: a stranger's withdrawal answers 404 and changes no row;
 *  - only still-open lines are withdrawn: a `parsed` line keeps its answer, and repeating the request changes nothing;
 *  - the job aggregate is recomputed in the same call: withdrawing the last open line completes the job;
 *  - THE RULE with the worker: a withdrawn line is not claimable, so its queued message invokes no engine (the
 *    worker half is `recipe-workers`' `parseLineClaim.e2e.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { parseJobResponseSchema, type ParseJobResponse } from '@kitchensink/schema-recipe';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { recipeDb } from '../../support/roleDb.js';

const OWNER = '01JPARSEWITHDRAWOWNER0000A';
const roleDb = recipeDb();

describe('parse job line withdrawal (LOCAL e2e)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
        await pool.end();
        await booted.close();
    });

    async function createJob(text: string): Promise<ParseJobResponse> {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
        });

        expect(response.status).toBe(202);

        return parseJobResponseSchema.parse(await response.json());
    }

    async function withdraw(jobId: string, lineIndexes: number[]): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${jobId}/withdraw-lines`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lineIndexes }),
        });
    }

    async function statuses(jobId: string): Promise<string[]> {
        const result = await pool.query(
            `SELECT status FROM recipe_parse_job_lines WHERE job_id = $1 ORDER BY line_index`,
            [jobId],
        );

        return result.rows.map((row: { status: string }) => row.status);
    }

    it('⛔ migration 0054: the CHECK admits withdrawn and still refuses an invented status', async () => {
        const job = await createJob('1 u54 migration line');

        await pool.query(`UPDATE recipe_parse_job_lines SET status = 'withdrawn' WHERE job_id = $1`, [job.id]);

        expect(await statuses(job.id)).toEqual(['withdrawn']);
        await expect(
            pool.query(`UPDATE recipe_parse_job_lines SET status = 'cancelled' WHERE job_id = $1`, [job.id]),
        ).rejects.toThrow(/recipe_parse_job_lines_status_check/u);
    });

    it('withdraws the open lines, completes the job, and is idempotent', async () => {
        const job = await createJob('1 u54 flour\n2 u54 eggs');

        const first = await withdraw(job.id, [0, 1]);

        expect(first.status).toBe(200);

        const body = parseJobResponseSchema.parse(await first.json());

        expect(body.lines.map((line) => line.status)).toEqual(['withdrawn', 'withdrawn']);
        expect(body.status).toBe('complete');

        const again = await withdraw(job.id, [0, 1]);

        expect(again.status).toBe(200);
        expect(await statuses(job.id)).toEqual(['withdrawn', 'withdrawn']);
    });

    it('⛔ leaves a landed line alone and withdraws a failed_retryable one', async () => {
        const job = await createJob('1 u54 landed\n2 u54 retryable\n3 u54 open');

        await pool.query(`UPDATE recipe_parse_job_lines SET status = 'parsed' WHERE job_id = $1 AND line_index = 0`, [
            job.id,
        ]);
        await pool.query(
            `UPDATE recipe_parse_job_lines SET status = 'failed_retryable' WHERE job_id = $1 AND line_index = 1`,
            [job.id],
        );

        const response = await withdraw(job.id, [0, 1, 2, 99]);

        expect(response.status).toBe(200);
        expect(await statuses(job.id)).toEqual(['parsed', 'withdrawn', 'withdrawn']);
    });

    it("⛔ a stranger's withdrawal answers 404 and changes nothing", async () => {
        const job = await createJob('1 u54 private');

        const stranger = await asPrincipal('01JPARSEWITHDRAWSTRANGER00', async () => withdraw(job.id, [0]));

        expect(stranger.status).toBe(404);
        expect(await statuses(job.id)).toEqual(['pending']);
    });

    it('answers an expired job with 409', async () => {
        const job = await createJob('1 u54 expired');

        await pool.query(`UPDATE recipe_parse_jobs SET expires_at = now() - interval '1 second' WHERE id = $1`, [
            job.id,
        ]);

        expect((await withdraw(job.id, [0])).status).toBe(409);
        expect(await statuses(job.id)).toEqual(['pending']);
    });
});
