/**
 * A parse job's per-line progress against the REAL app and database (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a;
 * plan 2026-10-15-011).
 *
 * What only this tier can prove — the mocked tier hands `ParseJobsService` ages it made up:
 *
 *  - the ages are measured by the DATABASE's clock, in the statement that reads the rows (`claimLine` stamps
 *    `last_received_at` with the database's `now()`, so the read must too);
 *  - they arrive as NUMBERS: `EXTRACT` answers `numeric`, which node-pg returns as a STRING unless cast to `float8`.
 *    JavaScript's `<=` would coerce a numeric string and hide that, so the DAL's own record is asserted directly — a
 *    string there is a type that lies to every later reader;
 *  - `attempts` NULL (a row from before migration 0046) reads as never claimed;
 *  - quiet is per JOB: of two jobs, only the one whose lines have all gone quiet reads `stalled`.
 *
 * The claim facts are written the way the worker writes them (`attempts`, `last_received_at`, `updated_at`), aged with
 * `now() - interval` so each phase sits well clear of its boundary; the exact boundaries are `lineProgress.test.ts`'s.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurgeQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';

import { parseJobResponseSchema, type ParseJobResponse } from '@kitchensink/schema-recipe';

import { createRecipeDrizzle } from '../../../src/database/client.js';
import { ParseJobsDal } from '../../../src/recipes/dal/parseJobs.dal.js';
import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { SEED_PARSE_QUEUE_URL } from '../../support/localHarness.js';
import { recipeDb } from '../../support/roleDb.js';

const OWNER = '01JPARSEPROGRESSOWNER0000A';
const roleDb = recipeDb();

describe('parse job progress (LOCAL e2e)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let sqs: SQSClient;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
        await sqs.send(new PurgeQueueCommand({ QueueUrl: SEED_PARSE_QUEUE_URL }));
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
        await pool.end();
        sqs.destroy();
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

    async function readJob(jobId: string): Promise<ParseJobResponse> {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${jobId}`);

        expect(response.status).toBe(200);

        return parseJobResponseSchema.parse(await response.json());
    }

    /** Age one line the way `claimLine` writes it: `attempts` claims, the last `claimedAgo` ago. */
    async function claim(jobId: string, lineIndex: number, attempts: number | null, claimedAgo: string): Promise<void> {
        await pool.query(
            `UPDATE recipe_parse_job_lines
                SET attempts = $3,
                    last_received_at = now() - $4::interval,
                    updated_at = now() - $4::interval
              WHERE job_id = $1 AND line_index = $2`,
            [jobId, lineIndex, attempts, claimedAgo],
        );
    }

    /** Move every line of a job's `updated_at` back, so the whole paste has been quiet for `ago`. */
    async function quieten(jobId: string, ago: string): Promise<void> {
        await pool.query(`UPDATE recipe_parse_job_lines SET updated_at = now() - $2::interval WHERE job_id = $1`, [
            jobId,
            ago,
        ]);
    }

    it("reads each pending line's phase from the claim facts, by the database's clock", async () => {
        const job = await createJob(
            [
                'progress queued apples',
                'progress reading pears',
                'progress retrying plums',
                'progress delayed figs',
            ].join('\n'),
        );

        // One line moved a second ago, so the paste is not quiet; the others carry their own claim facts.
        await claim(job.id, 1, 1, '5 seconds');
        await claim(job.id, 2, 3, '1 second');
        await claim(job.id, 3, 1, '200 seconds');

        const read = await readJob(job.id);

        expect(read.lines.map((line) => line.progress)).toEqual([
            { phase: 'queued' },
            { phase: 'reading' },
            { phase: 'retrying' },
            { phase: 'delayed' },
        ]);
    });

    it('hands the service its ages as numbers, measured by the database', async () => {
        const job = await createJob('progress number check olives');

        await claim(job.id, 0, 2, '30 seconds');

        const record = await new ParseJobsDal(createRecipeDrizzle(pool), pool).getJob(OWNER, job.id);
        const [line] = record?.lines ?? [];

        expect(typeof line?.claimAgeSeconds).toBe('number');
        expect(typeof record?.quietSeconds).toBe('number');
        // Thirty seconds by the database's clock, give or take the round trip.
        expect(line?.claimAgeSeconds).toBeGreaterThanOrEqual(30);
        expect(line?.claimAgeSeconds).toBeLessThan(40);
        expect(line?.attempts).toBe(2);
    });

    it('reads a NULL attempt count as never claimed', async () => {
        const job = await createJob('progress null attempts quince');

        await pool.query(
            'UPDATE recipe_parse_job_lines SET attempts = NULL, last_received_at = NULL WHERE job_id = $1',
            [job.id],
        );

        expect((await readJob(job.id)).lines[0]?.progress).toEqual({ phase: 'queued' });
    });

    it('calls only the quiet paste stalled: quiet is measured per job', async () => {
        const quiet = await createJob('progress quiet one\nprogress quiet two');
        const busy = await createJob('progress busy one\nprogress busy two');

        await claim(quiet.id, 0, 1, '400 seconds');
        await quieten(quiet.id, '400 seconds');
        await quieten(busy.id, '400 seconds');
        // A sibling in the busy paste moved a moment ago, so its never-claimed line is waiting its turn.
        await claim(busy.id, 1, 1, '1 second');

        expect((await readJob(quiet.id)).lines.map((line) => line.progress?.phase)).toEqual(['stalled', 'stalled']);
        expect((await readJob(busy.id)).lines.map((line) => line.progress?.phase)).toEqual(['queued', 'reading']);
    });

    it('gives a landed line no progress', async () => {
        const job = await createJob('progress landed walnut');

        await pool.query(
            `UPDATE recipe_parse_job_lines
                SET status = 'unparseable', attempts = 1, last_received_at = now(), updated_at = now()
              WHERE job_id = $1`,
            [job.id],
        );

        expect((await readJob(job.id)).lines[0]?.progress).toBeNull();
    });
});
