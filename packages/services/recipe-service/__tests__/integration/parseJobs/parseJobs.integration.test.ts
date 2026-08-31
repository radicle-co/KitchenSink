/**
 * U9 — the parse-job resource against the REAL app, database and LocalStack queue.
 *
 * What only this tier can prove (the unit suite's fakes replace every layer these claims live in):
 *
 *  - the create writes job + line rows with the digests the messages carry, and the messages actually
 *    reach the `recipe-parse-line` queue in the consumer's shape;
 *  - owner scoping is a WHERE clause, not a service nicety — a stranger's poll/retry/edit answers 404
 *    against the same rows;
 *  - **R17's full race**: a landing built against the OLD digest (the worker's own guarded UPDATE,
 *    mirrored verbatim below) matches ZERO rows after an edit, the edit re-drives its own message, and a
 *    landing under the NEW digest lands — so the job reaches a terminal state without waiting for TTL;
 *  - retry resets exactly the `failed_retryable` lines, and an expired job refuses retry/edit with 409
 *    even BEFORE the sweep flips its stored status (expiry is derived from the timestamp).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurgeQueueCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_PARSE_QUEUE_URL } from '../../../tests/globalSetup.js';

const OWNER = '01JPARSEJOBOWNER00000000AA';
const STRANGER = '01JPARSEJOBSTRANGER00000AA';
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

interface JobView {
    id: string;
    status: string;
    expiresAt: string;
    lines: { lineIndex: number; sourceLine: string; status: string; proposal: unknown }[];
}

describe.skipIf(!hasDatabaseUrl)('recipe parse jobs (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let sqs: SQSClient;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
        await sqs.send(new PurgeQueueCommand({ QueueUrl: SEED_PARSE_QUEUE_URL }));
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id IN ($1, $2)', [OWNER, STRANGER]);
        await pool.end();
        sqs.destroy();
        await booted.close();
    });

    async function createJob(text: string): Promise<JobView> {
        const response = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
        });

        expect(response.status).toBe(202);

        return (await response.json()) as JobView;
    }

    /** Drain up to `max` messages from the parse queue (LocalStack). */
    async function drainQueue(max: number): Promise<Record<string, unknown>[]> {
        const bodies: Record<string, unknown>[] = [];

        for (let attempt = 0; attempt < 10 && bodies.length < max; attempt += 1) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SEED_PARSE_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 1,
                }),
            );

            for (const message of received.Messages ?? []) {
                bodies.push(JSON.parse(message.Body ?? '{}') as Record<string, unknown>);
            }

            if ((received.Messages ?? []).length === 0 && bodies.length > 0) {
                break;
            }
        }

        return bodies;
    }

    /**
     * The WORKER's landing UPDATE, mirrored verbatim from `recipe-workers/handlers/parseLine.ts` — this
     * suite's job is to prove the digest guard from the producer's side of the same table.
     */
    async function landAs(jobId: string, lineIndex: number, digest: string, proposal: object): Promise<number> {
        const result = await pool.query(
            `UPDATE recipe_parse_job_lines
                SET status = $4,
                    proposal = $5::jsonb,
                    llm_attempts = $6,
                    updated_at = now()
              WHERE job_id = $1 AND line_index = $2 AND line_digest = $3`,
            [jobId, lineIndex, digest, 'parsed', JSON.stringify(proposal), 1],
        );

        return result.rowCount ?? 0;
    }

    const PROPOSAL = {
        raw: '3 large eggs',
        quantity: { kind: 'exact', value: 3 },
        unit: null,
        statedMeasure: '3',
        foods: [{ name: 'eggs', prep: null }],
        reviewReasons: [],
    };

    it('202 + poll: create stores digested rows, enqueues the consumer shape, and the poll answers the view', async () => {
        const job = await createJob('2 cups flour\n\n  3 large eggs  ');

        expect(job.status).toBe('running');
        expect(job.lines.map((line) => line.sourceLine)).toEqual(['2 cups flour', '3 large eggs']);

        const rows = await pool.query(
            'SELECT line_index, source_line, line_digest FROM recipe_parse_job_lines WHERE job_id = $1 ORDER BY line_index',
            [job.id],
        );

        expect(rows.rows).toHaveLength(2);

        const messages = await drainQueue(2);
        const forJob = messages.filter((message) => message['jobId'] === job.id);

        expect(forJob).toHaveLength(2);

        // The message digest IS the stored digest — three-way agreement is R17's precondition.
        for (const message of forJob) {
            const stored = (rows.rows as { line_index: number; line_digest: string }[]).find(
                (row) => row.line_index === message['lineIndex'],
            );

            expect(message['lineDigest']).toBe(stored?.line_digest);
            expect(message['userId']).toBe(OWNER);
        }

        const poll = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}`);

        expect(poll.status).toBe(200);
        expect(((await poll.json()) as JobView).lines.every((line) => line.status === 'pending')).toBe(true);
    });

    it("a stranger polling, retrying, or editing another user's job gets 404 — never a 403", async () => {
        const job = await createJob('1 tsp salt');
        await drainQueue(1);

        await asPrincipal(STRANGER, async () => {
            const poll = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}`);
            const retry = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/retry`, { method: 'POST' });
            const edit = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/lines/0`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sourceLine: 'hijacked' }),
            });

            expect(poll.status).toBe(404);
            expect(retry.status).toBe(404);
            expect(edit.status).toBe(404);
            expect(((await poll.json()) as { code: string }).code).toBe('PARSE_JOB_NOT_FOUND');
        });
    });

    it('R17 end to end: an edit discards the stale landing, re-drives the new phrase, and the job still terminates', async () => {
        const job = await createJob('2 cups flour\n3 large eggs');
        await drainQueue(2);
        const before = await pool.query(
            'SELECT line_digest FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 1',
            [job.id],
        );
        const oldDigest = (before.rows[0] as { line_digest: string }).line_digest;

        // The cook edits line 1 while the worker is still parsing the ORIGINAL phrase.
        const edit = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/lines/1`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceLine: '4 small eggs' }),
        });

        expect(edit.status).toBe(202);

        // The edit re-drove its own message, carrying the NEW digest.
        const redriven = await drainQueue(1);
        const editMessage = redriven.find((message) => message['jobId'] === job.id && message['lineIndex'] === 1);

        expect(editMessage?.['sourceLine']).toBe('4 small eggs');
        expect(editMessage?.['lineDigest']).not.toBe(oldDigest);

        // The worker's landing for the OLD phrase arrives late — and matches ZERO rows.
        expect(await landAs(job.id, 1, oldDigest, PROPOSAL)).toBe(0);

        // Landings under the CURRENT digests land, and the job reaches a terminal state without TTL.
        const digests = await pool.query(
            'SELECT line_index, line_digest FROM recipe_parse_job_lines WHERE job_id = $1 ORDER BY line_index',
            [job.id],
        );

        for (const row of digests.rows as { line_index: number; line_digest: string }[]) {
            expect(await landAs(job.id, row.line_index, row.line_digest, PROPOSAL)).toBe(1);
        }

        // The worker's aggregate (shared SQL) flips the job — mirror its statement's effect by running it.
        const { PARSE_JOB_AGGREGATE_SQL } = await import('@kitchensink/recipe-core/parsing/parse-job-aggregate');
        await pool.query(PARSE_JOB_AGGREGATE_SQL, [job.id]);

        const poll = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}`);
        const view = (await poll.json()) as JobView;

        expect(view.status).toBe('complete');
        expect(view.lines[1]?.proposal).toEqual(PROPOSAL);
    });

    it('retry re-drives exactly the failed_retryable lines; an expired job refuses with 409 pre-sweep', async () => {
        const job = await createJob('1 cup milk\n1 cup cream');
        await drainQueue(2);

        // A partial outage: line 1 failed transiently, line 0 parsed.
        const digests = await pool.query(
            'SELECT line_index, line_digest FROM recipe_parse_job_lines WHERE job_id = $1 ORDER BY line_index',
            [job.id],
        );
        const rows = digests.rows as { line_index: number; line_digest: string }[];
        await landAs(job.id, 0, rows[0]?.line_digest ?? '', PROPOSAL);
        await pool.query(
            `UPDATE recipe_parse_job_lines SET status = 'failed_retryable' WHERE job_id = $1 AND line_index = 1`,
            [job.id],
        );

        const retry = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/retry`, { method: 'POST' });

        expect(retry.status).toBe(202);

        const redriven = (await drainQueue(1)).filter((message) => message['jobId'] === job.id);

        // ONLY the failed line was re-driven — the parsed line's work is not re-paid.
        expect(redriven).toHaveLength(1);
        expect(redriven[0]?.['lineIndex']).toBe(1);

        const statuses = await pool.query(
            'SELECT line_index, status FROM recipe_parse_job_lines WHERE job_id = $1 ORDER BY line_index',
            [job.id],
        );

        expect(statuses.rows).toEqual([
            { line_index: 0, status: 'parsed' },
            { line_index: 1, status: 'pending' },
        ]);

        // Expiry is DERIVED: past `expires_at`, mutations refuse even before the sweep flips the status.
        await pool.query(`UPDATE recipe_parse_jobs SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
            job.id,
        ]);

        const lateRetry = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/retry`, { method: 'POST' });
        const lateEdit = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/lines/1`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceLine: 'too late' }),
        });

        expect(lateRetry.status).toBe(409);
        expect(lateEdit.status).toBe(409);
        expect(((await lateRetry.json()) as { code: string }).code).toBe('PARSE_JOB_EXPIRED');
    });

    it('rejects an inadmissible paste with 400, naming the offending line', async () => {
        const response = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `fine\n${'x'.repeat(1001)}` }),
        });

        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toContain('line 1');
    });
});
