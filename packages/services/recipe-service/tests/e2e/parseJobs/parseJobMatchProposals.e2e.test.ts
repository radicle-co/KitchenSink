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

import { parseJobResponseSchema } from '@kitchensink/schema-recipe';
import { periodKey } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import {
    verificationOriginOf,
    verifiedLineIdentityOfMessage,
    verifyIngredientLineMessageSchema,
} from '@kitchensink/recipe-core/resolution/verification-message';

import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { sha256Hex } from '../../../src/common/sha256.js';
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
             VALUES ($1, 0, '2 cups milk', $3, 'parsed', $2::jsonb)`,
            // The REAL digest of the text, as the create path stores it: the view's staleness check recomputes it.
            [id, JSON.stringify(proposal), lineDigest('2 cups milk', sha256Hex)],
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
        // The unit is the cook's word (`cups`, from the parse's statedMeasure), as the editor saves it (ADR-0071).
        expect(message).toMatchObject({
            foodId: 'F-whole',
            quantityLow: 2,
            unit: 'cups',
            evidenceKind: 'unattributed',
        });
        // ⛔ The key the worker will write the verdict under, derived from the message it DRAINED, is the key the row
        // stored: the job view reads the verdict back through the row's key (ADR-0071).
        expect(verificationKey(verifiedLineIdentityOfMessage(message), sha256Hex)).toBe(rows.rows[0]?.verification_key);
    });

    it('⛔ a second call writes and sends nothing more', async () => {
        const jobId = await parsedJob();

        await proposeMatches(jobId);
        await drainQueue();

        const again = await proposeMatches(jobId);

        expect(again.status).toBe(202);
        expect(await drainQueue()).toEqual([]);
    });

    /** GET the job and return food 0 of line 0's match. */
    async function matchOnView(jobId: string): Promise<unknown> {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${jobId}`, {
            headers: { authorization: bearerFor(OWNER) },
        });
        const body = parseJobResponseSchema.parse(await response.json());

        return body.lines[0]?.proposal?.foods[0]?.match;
    }

    /** The verification key the proposal's row stored. */
    async function storedKey(jobId: string): Promise<string> {
        const rows = await pool.query<{ verification_key: string }>(
            'SELECT verification_key FROM recipe_parse_job_matches WHERE job_id = $1',
            [jobId],
        );

        return rows.rows[0]?.verification_key ?? '';
    }

    it('the view reads `checking`, then `confident` once a verdict verifying identity lands in the REAL table', async () => {
        const jobId = await parsedJob();

        await proposeMatches(jobId);

        expect(await matchOnView(jobId)).toMatchObject({
            state: 'checking',
            proposed: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
        });

        const key = await storedKey(jobId);

        await pool.query(
            `INSERT INTO recipe_ingredient_verifications
                 (verification_key, verdict, certainty, band, aspects, identity_verdict, quantity_verdict, model_id, food_id)
             VALUES ($1, 'agree', 'high', 'verified', ARRAY['identity', 'quantity'], 'agree', 'agree', 'test-model', 'F-whole')`,
            [key],
        );

        try {
            expect(await matchOnView(jobId)).toMatchObject({ state: 'confident', reason: 'reviewVerified' });
        } finally {
            await pool.query('DELETE FROM recipe_ingredient_verifications WHERE verification_key = $1', [key]);
        }
    });

    it('the view reads `needsChoice` once the gate GAVE UP on the key (an attempts row with a failure code)', async () => {
        const jobId = await parsedJob();

        await proposeMatches(jobId);

        const key = await storedKey(jobId);

        await pool.query(
            `INSERT INTO recipe_verification_attempts (verification_key, model_id, attempts, failure_code)
             VALUES ($1, 'test-model', 5, 'VERIFICATION_ATTEMPTS_EXHAUSTED')`,
            [key],
        );

        try {
            expect(await matchOnView(jobId)).toMatchObject({ state: 'needsChoice', reason: 'reviewUnchecked' });
        } finally {
            await pool.query('DELETE FROM recipe_verification_attempts WHERE verification_key = $1', [key]);
        }
    });

    /**
     * ADR-0024 §3 / ADR-0071 §9 (owner ruling 2026-10-26): the worker stored that the spend ceiling refused this key's
     * review, with the period it captured at reserve. The view a client reads then surfaces the food as a choice.
     */
    describe('a review the spend ceiling refused (the fact the worker stores)', () => {
        async function spentIn(jobId: string, period: string): Promise<string> {
            const key = await storedKey(jobId);

            await pool.query(
                `INSERT INTO recipe_verification_attempts (verification_key, model_id, attempts, budget_spent_period)
                 VALUES ($1, 'test-model', 1, $2)`,
                [key, period],
            );

            return key;
        }

        const clean = (key: string): Promise<unknown> =>
            pool.query('DELETE FROM recipe_verification_attempts WHERE verification_key = $1', [key]);

        it('⛔ in the CURRENT period the view reads `needsChoice` / `reviewBudgetSpent`, the food kept as a candidate, with the reset date', async () => {
            const jobId = await parsedJob();

            await proposeMatches(jobId);

            const key = await spentIn(jobId, periodKey(new Date()));

            try {
                const match = (await matchOnView(jobId)) as {
                    state: string;
                    reason: string;
                    proposed: unknown;
                    candidates: { id: string }[];
                    reviewResetsAt?: string;
                };
                const end = new Date(match.reviewResetsAt ?? '');

                expect(match).toMatchObject({ state: 'needsChoice', reason: 'reviewBudgetSpent', proposed: null });
                expect(match.candidates.map((candidate) => candidate.id)).toContain('F-whole');
                // The first instant of the next UTC month: the period the fact was captured in has just ended.
                expect(periodKey(new Date(end.getTime() - 1))).toBe(periodKey(new Date()));
                expect(periodKey(end)).not.toBe(periodKey(new Date()));
            } finally {
                await clean(key);
            }
        });

        it('⛔ a fact from an EARLIER period is not spent: the review reads `checking` again, with no reset date', async () => {
            const jobId = await parsedJob();

            await proposeMatches(jobId);

            const key = await spentIn(jobId, '2020-01');

            try {
                const match = (await matchOnView(jobId)) as Record<string, unknown>;

                expect(match).toMatchObject({ state: 'checking', reason: 'awaitingReview' });
                expect(match).not.toHaveProperty('reviewResetsAt');
            } finally {
                await clean(key);
            }
        });

        it('⛔ a verdict that asked identity outranks the fact: a real judgement is on record', async () => {
            const jobId = await parsedJob();

            await proposeMatches(jobId);

            const key = await spentIn(jobId, periodKey(new Date()));

            await pool.query(
                `INSERT INTO recipe_ingredient_verifications
                     (verification_key, verdict, certainty, band, aspects, identity_verdict, quantity_verdict, model_id, food_id)
                 VALUES ($1, 'agree', 'high', 'verified', ARRAY['identity', 'quantity'], 'agree', 'agree', 'test-model', 'F-whole')`,
                [key],
            );

            try {
                expect(await matchOnView(jobId)).toMatchObject({ state: 'confident', reason: 'reviewVerified' });
            } finally {
                await clean(key);
                await pool.query('DELETE FROM recipe_ingredient_verifications WHERE verification_key = $1', [key]);
            }
        });
    });
});
