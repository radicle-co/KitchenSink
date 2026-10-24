/**
 * Partial enqueue failure, against a REAL PostgreSQL and a transport that manufactures one.
 *
 * ⛔ WHY THIS TIER, AND WHY ITS TRANSPORT IS FAKE. The claim is about ROWS — which `recipe_parse_job_lines`
 * are left `failed_retryable` and which keep waiting on a message the queue accepted — and the unit suite
 * asserts that against a mocked DAL, which cannot say whether the `UPDATE`'s `WHERE` reaches the lines it
 * names. The transport is injected because the boundary it models cannot be provoked: LocalStack accepts
 * every batch, so a partial-batch rejection has to be supplied rather than caused (see
 * `common/sqsBatchQueue.ts` on why `SqsBatchSend` is a seam at all).
 *
 * Connects as `recipe_app` (DML only — the production role), per ADR-0039 and `tests/support/roleDb.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SendMessageBatchCommandInput, SendMessageBatchCommandOutput } from '@aws-sdk/client-sqs';
import pg from 'pg';

import { createRecipeDrizzle } from '../../src/database/client.js';
import { ParseJobsDal } from '../../src/recipes/dal/parseJobs.dal.js';
import { createParseJobQueue } from '../../src/recipes/parseJob.queue.js';
import { ParseJobsService } from '../../src/recipes/parseJobs.service.js';
import { recipeDb } from '../support/roleDb.js';

const OWNER = '01JPARSEATTRIBUTIONOWNER0A';
const QUEUE_URL = 'https://sqs.test.invalid/recipe-parse-line';
const PASTE = '2 cups flour\n1 tsp salt\n3 large eggs';
const roleDb = recipeDb();

describe('parse-job enqueue attribution (LOCAL e2e, real Postgres)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    });

    afterEach(async () => {
        // Jobs cascade to their lines.
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** The service over the REAL DAL, with `send` answering whatever the case needs. */
    function serviceOver(send: (input: SendMessageBatchCommandInput) => Promise<SendMessageBatchCommandOutput>) {
        const dal = new ParseJobsDal(createRecipeDrizzle(pool), pool);

        // ⚠️ Unlabelled, as an emulator-addressed queue is: `MessageGroupId` inside a batch entry is an
        // AWS-only capability, and nothing here is AWS.
        return new ParseJobsService(dal, createParseJobQueue(send, QUEUE_URL, false));
    }

    /** Every line's status, by index, read back from the rows rather than from the returned view. */
    async function storedStatuses(jobId: string): Promise<readonly string[]> {
        const { rows } = await pool.query<{ line_index: number; status: string }>(
            'SELECT line_index, status FROM recipe_parse_job_lines WHERE job_id = $1 ORDER BY line_index',
            [jobId],
        );

        return rows.map((row) => row.status);
    }

    /** The job row's own status, as the DAL recomputed it — not the status the service reported. */
    async function storedJobStatus(jobId: string): Promise<string | undefined> {
        const { rows } = await pool.query<{ status: string }>('SELECT status FROM recipe_parse_jobs WHERE id = $1', [
            jobId,
        ]);

        return rows[0]?.status;
    }

    /**
     * ⛔ THE ROWS THE QUEUE TOOK MUST NOT BE MARKED. `POST /recipe-parse-jobs/:id/retry` re-drives exactly
     * the `failed_retryable` lines, so a line marked here is a second engine ask for work already in flight
     * — and the cook watches a line that is being parsed be reported as failed.
     */
    it('⛔ leaves the lines the queue TOOK pending, and marks only the entry it rejected', async () => {
        const service = serviceOver(async () => ({
            $metadata: {},
            Successful: [],
            Failed: [{ Id: '1', Code: 'InternalError', SenderFault: false, Message: 'throttled' }],
        }));

        const view = await service.create(OWNER, PASTE);

        expect(await storedStatuses(view.id)).toEqual(['pending', 'failed_retryable', 'pending']);
        expect(view.lines.map((line) => line.status)).toEqual(['pending', 'failed_retryable', 'pending']);
    });

    /**
     * ⛔ THE AGGREGATE THE SERVICE REPORTS MUST BE THE ONE THE DATABASE HOLDS. `create` rebuilds its
     * response locally rather than re-reading (a re-read races the worker), so the job status it names is a
     * CLAIM about what the DAL recomputed. If the two diverge, the `202` and the very next `GET` disagree,
     * and the client picks its poll cadence off the wrong one.
     */
    it('⛔ reports the job status the DAL recomputed, not a locally assumed one', async () => {
        const service = serviceOver(async () => ({
            $metadata: {},
            Successful: [],
            Failed: [{ Id: '1', Code: 'InternalError', SenderFault: false }],
        }));

        const view = await service.create(OWNER, PASTE);

        expect(view.status).toBe(await storedJobStatus(view.id));
    });

    /**
     * The positive control for the assertion above: the same predicate over a failure that attributes
     * nothing must reach EVERY row. Without it, "two lines are still pending" would also pass against an
     * `UPDATE` that matched nothing at all.
     */
    it('marks every line when the transport itself fails — attribution is absent, so none is exonerated', async () => {
        const service = serviceOver(async () => {
            throw new Error('ECONNREFUSED');
        });

        const view = await service.create(OWNER, PASTE);

        expect(await storedStatuses(view.id)).toEqual(['failed_retryable', 'failed_retryable', 'failed_retryable']);
    });

    it('leaves every line pending when the whole batch lands', async () => {
        const service = serviceOver(async () => ({ $metadata: {}, Successful: [], Failed: [] }));

        const view = await service.create(OWNER, PASTE);

        expect(await storedStatuses(view.id)).toEqual(['pending', 'pending', 'pending']);
        expect(view.status).toBe('running');
    });
});
