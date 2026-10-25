/**
 * `POST /api/v1/recipe-parse-jobs/:id/matches` end to end on a developer's machine (ADR-0071): the real app, a real
 * PostgreSQL for the job and the match table, LocalStack's verification queue, and food faked at the network.
 *
 * The parse worker does not run here, so a parsed line is written straight into `recipe_parse_job_lines` with the
 * proposal the worker would land. What is proven across real boundaries: a proposal row is stored in the real table
 * for the real job, one verification message reaches the real queue and parses against the consumer's own schema,
 * and a second call writes and sends nothing more.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from '@aws-sdk/client-sqs';
import pg from 'pg';

import {
    verificationOriginOf,
    verifyIngredientLineMessageSchema,
} from '@kitchensink/recipe-core/resolution/verification-message';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { SEED_VERIFICATION_QUEUE_URL } from '../../support/localHarness.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { recipeDb } from '../../support/roleDb.js';

const OWNER = '01JMATCHFLOWE2EOWNER00000A';
const roleDb = recipeDb();

describe('paste-job match proposals (LOCAL e2e)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let sqs: SQSClient;
    let food: FoodFake;

    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set('F-whole', { name: 'Milk, whole', status: 'RESOLVED' });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
        await drainQueue();
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
        await drainQueue();
    });

    afterAll(async () => {
        sqs?.destroy();
        await pool?.end();
        await booted?.close();
        await food?.close();
        delete process.env['FOOD_SERVICE_URL'];
    });

    /** Receive and delete every message on the verification queue, returning their bodies. */
    async function drainQueue(): Promise<string[]> {
        const bodies: string[] = [];

        for (;;) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SEED_VERIFICATION_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 1,
                }),
            );
            const messages: Message[] = received.Messages ?? [];

            if (messages.length === 0) {
                return bodies;
            }

            for (const message of messages) {
                bodies.push(message.Body ?? '');
                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: SEED_VERIFICATION_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        }
    }

    /** A live job with one parsed line, as the worker would have landed it. */
    async function parsedJob(): Promise<string> {
        const job = await pool.query<{ id: string }>(
            `INSERT INTO recipe_parse_jobs (owner_id, expires_at, status)
             VALUES ($1, now() + interval '1 day', 'complete') RETURNING id`,
            [OWNER],
        );
        const id = job.rows[0]?.id ?? '';
        const proposal = {
            raw: '2 cups milk',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            statedMeasure: '2 cups',
            foods: [{ name: 'milk', prep: null }],
            reviewReasons: [],
        };

        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest, status, proposal)
             VALUES ($1, 0, '2 cups milk', 'digest-milk', 'parsed', $2::jsonb)`,
            [id, JSON.stringify(proposal)],
        );

        return id;
    }

    async function proposeMatches(jobId: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${jobId}/matches`, {
            method: 'POST',
            headers: { authorization: bearerFor(OWNER) },
        });
    }

    it('stores the proposal in the real table and sends one message the CONSUMER’s schema accepts', async () => {
        const jobId = await parsedJob();

        const response = await proposeMatches(jobId);

        expect(response.status).toBe(202);

        const rows = await pool.query(
            `SELECT matched_by, food_id, verification_key, enqueued_at FROM recipe_parse_job_matches WHERE job_id = $1`,
            [jobId],
        );

        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]).toMatchObject({ matched_by: 'lexical', food_id: 'F-whole' });
        expect(rows.rows[0]?.verification_key).toMatch(/^v2:/u);
        expect(rows.rows[0]?.enqueued_at).not.toBeNull();

        const bodies = await drainQueue();

        expect(bodies).toHaveLength(1);

        const message = verifyIngredientLineMessageSchema.parse(JSON.parse(bodies[0] ?? '{}'));

        expect(verificationOriginOf(message)).toStrictEqual({ kind: 'parseJob', jobId, lineIndex: 0, foodIndex: 0 });
        expect(message).toMatchObject({ foodId: 'F-whole', quantityLow: 2, unit: 'cup', evidenceKind: 'unattributed' });
    });

    it('⛔ a second call writes and sends nothing more', async () => {
        const jobId = await parsedJob();

        await proposeMatches(jobId);
        await drainQueue();

        const again = await proposeMatches(jobId);

        expect(again.status).toBe(202);
        expect(await drainQueue()).toEqual([]);
    });
});
