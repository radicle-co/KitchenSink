/**
 * ADR-0040 — test-principal CONTAINMENT and the SELF-PURGE door against the REAL stack: a booted Nest app verifying
 * REAL RS256 tokens through `@clerk/backend`, Docker Postgres as the service role (ADR-0039), and LocalStack SQS.
 *
 * What only this tier can prove, and why each needs the real stack:
 *
 *  - **The claim reaches the policy.** A token whose SIGNED `public_metadata.testPrincipal` is `true` is verified by
 *    the real `verifyToken`, turned into a `test` principal by the real middleware, and contained by the real
 *    policies: a public recipe, a rating and an erasure each answer `403 TEST_PRINCIPAL_CONTAINED` and write nothing.
 *  - **The registry is written by the request itself** — the middleware upserts `test_principals` for a signed test
 *    principal before the controller runs, so the self-purge's second witness exists.
 *  - **The door is invisible to everyone else** — a real user's `POST` and `GET` both answer `404 NOT_FOUND`, and a
 *    signed test principal the registry does NOT hold is refused the same way.
 *  - **Real index arbitration and a real queue** — a second request returns the job already in flight, exactly one
 *    `testPrincipalReset` message is sent, and while the job is active the principal's writes answer `423`.
 *
 * The PURGE itself — the worker's statements, both buckets' owner prefix, the job reaching `completed` — lives in
 * `@kitchensink/recipe-workers`, because this service does not (and must not) depend on its own consumer.
 *
 * The stage runs with `TEST_PRINCIPAL_CONTAINMENT` UNSET, which must parse to `enforce` — the production default.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_ERASURE_QUEUE_URL, SEED_VERIFICATION_QUEUE_URL } from '../../../tests/globalSetup.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { recipeDb } from '../../../tests/support/roleDb.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE } from '../../../src/account/dto/erasure.dto.js';

const AZP = 'https://recipes.example.com';
/** A signed test principal the registry will learn from its first request. */
const TEST_USER = '01JZRESETINTEGRATIONTEST01';
/** A signed test principal whose registry row is removed mid-suite — the "claim without registry" case. */
const UNREGISTERED_TEST_USER = '01JZRESETINTEGRATIONTEST02';
/** A real user — no marker in its metadata at all. */
const REAL_USER = '01JZRESETINTEGRATIONREAL01';

const RECIPE_PAYLOAD = {
    title: 'Containment Probe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: [],
    dietaryFlags: [],
    ingredients: [
        {
            ingredientId: '00000000-0000-4000-8000-0000000000aa',
            name: 'Flour',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
        },
    ],
    steps: [{ instruction: 'Mix.' }],
};

const roleDb = recipeDb();

describe.skipIf(!hasDatabaseUrl)('test-principal containment + self-purge over the wire (ADR-0040)', () => {
    const keypair = generateClerkKeypair();
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let sqs: SQSClient;

    /** A bearer for `userId`, marked as a test principal or not. */
    function bearer(userId: string, testPrincipal: boolean, permissions: readonly string[] = ['premium']): string {
        return `Bearer ${mintToken(keypair.privateKeyPem, {
            sub: `user_${userId}`,
            azp: AZP,
            externalId: userId,
            permissions,
            ...(testPrincipal ? { testPrincipal: true } : {}),
        })}`;
    }

    /** One JSON request as `authorization`. */
    async function call(
        method: string,
        path: string,
        authorization: string,
        body?: unknown,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                authorization,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();

        return { status: response.status, body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
    }

    /** Receive and delete every message on a queue (the erasure queue by default), returning the parsed bodies. */
    async function drainQueue(queueUrl: string = SEED_ERASURE_QUEUE_URL): Promise<Record<string, unknown>[]> {
        const bodies: Record<string, unknown>[] = [];

        for (;;) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: queueUrl,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 0,
                }),
            );
            const messages = received.Messages ?? [];

            if (messages.length === 0) {
                return bodies;
            }

            for (const message of messages) {
                bodies.push(JSON.parse(message.Body ?? '{}') as Record<string, unknown>);
                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: queueUrl,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        }
    }

    /** Remove every row this suite's principals could have written. */
    async function cleanRows(): Promise<void> {
        const users = [TEST_USER, UNREGISTERED_TEST_USER, REAL_USER];

        await pool.query(
            'DELETE FROM recipe_ratings WHERE recipe_id IN (SELECT id FROM recipes WHERE owner_id = ANY($1))',
            [users],
        );
        await pool.query('DELETE FROM test_reset_jobs WHERE user_id = ANY($1)', [users]);
        await pool.query('DELETE FROM account_erasure_jobs WHERE owner_id = ANY($1)', [users]);
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [users]);
    }

    beforeAll(async () => {
        // The REAL verification path — a bypass left behind by an earlier suite must not short-circuit it.
        delete process.env['RECIPE_DEV_AUTH_USER_ID'];
        // Deliberately UNSET: the production default must be `enforce`.
        delete process.env['TEST_PRINCIPAL_CONTAINMENT'];
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
        process.env['RATE_LIMIT_PHOTO_UPLOAD'] = '1000';
        process.env['RATE_LIMIT_WRITE'] = '1000';

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
        await cleanRows();
        await drainQueue();
    });

    afterEach(async () => {
        await cleanRows();
        await drainQueue();
    });

    afterAll(async () => {
        await cleanRows();
        await pool?.end();
        await booted?.close();
    });

    describe('containment keys on the SIGNED claim', () => {
        it('⛔ answers 403 TEST_PRINCIPAL_CONTAINED to a test principal’s PUBLIC recipe, and writes no row', async () => {
            const response = await call('POST', '/api/v1/recipes', bearer(TEST_USER, true), {
                ...RECIPE_PAYLOAD,
                visibility: 'public',
            });

            expect(response.status).toBe(403);
            expect(response.body['code']).toBe('TEST_PRINCIPAL_CONTAINED');
            const rows = await pool.query('SELECT 1 FROM recipes WHERE owner_id = $1', [TEST_USER]);
            expect(rows.rows).toHaveLength(0);
        });

        it('lets the same test principal create a PRIVATE recipe — the owner-scoped path stays open', async () => {
            const response = await call('POST', '/api/v1/recipes', bearer(TEST_USER, true), {
                ...RECIPE_PAYLOAD,
                visibility: 'private',
            });

            expect(response.status).toBe(201);
        });

        it('lets a REAL user publish, unchanged', async () => {
            const response = await call('POST', '/api/v1/recipes', bearer(REAL_USER, false), {
                ...RECIPE_PAYLOAD,
                visibility: 'public',
            });

            expect(response.status).toBe(201);
        });

        it('⛔ answers 403 to a test principal’s rating of a real user’s public recipe, before any read', async () => {
            const created = await call('POST', '/api/v1/recipes', bearer(REAL_USER, false), {
                ...RECIPE_PAYLOAD,
                visibility: 'public',
            });
            const recipeId = String(created.body['id']);

            const response = await call('PUT', `/api/v1/recipes/${recipeId}/rating`, bearer(TEST_USER, true), {
                stars: 5,
            });

            expect(response.status).toBe(403);
            expect(response.body['code']).toBe('TEST_PRINCIPAL_CONTAINED');
            const ratings = await pool.query('SELECT 1 FROM recipe_ratings WHERE user_id = $1', [TEST_USER]);
            expect(ratings.rows).toHaveLength(0);
        });

        it('⛔ answers 403 to a test principal’s account erasure, and records no erasure job', async () => {
            const response = await call('POST', '/api/v1/account/erasure', bearer(TEST_USER, true), {
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            });

            expect(response.status).toBe(403);
            expect(response.body['code']).toBe('TEST_PRINCIPAL_CONTAINED');
            const jobs = await pool.query('SELECT 1 FROM account_erasure_jobs WHERE owner_id = $1', [TEST_USER]);
            expect(jobs.rows).toHaveLength(0);
            expect(await drainQueue()).toEqual([]);
        });
    });

    describe('⛔ a contained test principal’s save never reaches the verification gate (HIGH-2)', () => {
        /** A food-BACKED catalog row — the seeded ingredients are user-entered, which the producer skips anyway. */
        const FOOD_BACKED_INGREDIENT_ID = '00000000-0000-4000-8000-0000004e5a01';

        /** A transcribed, food-backed line: exactly what the producer asks the gate about. */
        const verifiablePayload = {
            ...RECIPE_PAYLOAD,
            visibility: 'private',
            ingredients: [
                {
                    ingredientId: FOOD_BACKED_INGREDIENT_ID,
                    name: 'Flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    sourceLine: '2 cups of sifted pastry flour',
                },
            ],
        };

        beforeAll(async () => {
            await pool.query(
                `INSERT INTO ingredients (id, name, food_id, food_resolution_status, is_user_entered)
                 VALUES ($1, 'Flour, wheat, all-purpose', '01JCONTAINMENTVERIFYF00D01', 'RESOLVED', false)
                 ON CONFLICT (id) DO NOTHING`,
                [FOOD_BACKED_INGREDIENT_ID],
            );
            await drainQueue(SEED_VERIFICATION_QUEUE_URL);
        });

        afterEach(async () => {
            await drainQueue(SEED_VERIFICATION_QUEUE_URL);
        });

        it('sends NOTHING for a signed test principal, and ONE request for a real user saving the same body', async () => {
            // The real user is the control: without it, "nothing arrived" could mean the queue, the line or the
            // catalog row was wrong, and the containment case would pass while proving nothing.
            const contained = await call('POST', '/api/v1/recipes', bearer(TEST_USER, true), verifiablePayload);

            expect(contained.status).toBe(201);
            expect(await drainQueue(SEED_VERIFICATION_QUEUE_URL)).toEqual([]);

            const real = await call('POST', '/api/v1/recipes', bearer(REAL_USER, false), verifiablePayload);

            expect(real.status).toBe(201);
            const sent = await drainQueue(SEED_VERIFICATION_QUEUE_URL);

            expect(sent).toHaveLength(1);
            expect(sent[0]?.['recipeId']).toBe(real.body['id']);
        });
    });

    describe('POST /api/v1/account/test-reset', () => {
        it('⛔ is a 404 NOT_FOUND to a real user, and records nothing', async () => {
            const response = await call('POST', '/api/v1/account/test-reset', bearer(REAL_USER, false));

            expect(response.status).toBe(404);
            expect(response.body['code']).toBe('NOT_FOUND');
            const jobs = await pool.query('SELECT 1 FROM test_reset_jobs WHERE user_id = $1', [REAL_USER]);
            expect(jobs.rows).toHaveLength(0);
            // A real user is never written to the registry either.
            const registry = await pool.query('SELECT 1 FROM test_principals WHERE user_id = $1', [REAL_USER]);
            expect(registry.rows).toHaveLength(0);
        });

        it('registers the signed test principal, accepts the reset with 202, and sends ONE testPrincipalReset', async () => {
            const response = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));

            expect(response.status).toBe(202);
            expect(response.body['status']).toBe('queued');
            const registry = await pool.query('SELECT 1 FROM test_principals WHERE user_id = $1', [TEST_USER]);
            expect(registry.rows).toHaveLength(1);
            const jobs = await pool.query<{ id: string; status: string }>(
                'SELECT id, status FROM test_reset_jobs WHERE user_id = $1',
                [TEST_USER],
            );
            expect(jobs.rows).toEqual([{ id: response.body['jobId'], status: 'queued' }]);
            const messages = (await drainQueue()).filter((message) => message['ownerId'] === TEST_USER);
            expect(messages).toHaveLength(1);
            expect(messages[0]).toMatchObject({ kind: 'testPrincipalReset', ownerId: TEST_USER });
        });

        it('returns the job ALREADY in flight to a second request, and sends no second message', async () => {
            const first = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));
            await drainQueue();

            const second = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));

            expect(second.status).toBe(202);
            expect(second.body['jobId']).toBe(first.body['jobId']);
            expect((await drainQueue()).filter((message) => message['ownerId'] === TEST_USER)).toEqual([]);
        });

        it('⛔ locks the test principal’s writes with 423 while its reset is active — and not a real user’s', async () => {
            await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));

            const locked = await call('POST', '/api/v1/recipes', bearer(TEST_USER, true), {
                ...RECIPE_PAYLOAD,
                visibility: 'private',
            });
            const unaffected = await call('POST', '/api/v1/recipes', bearer(REAL_USER, false), {
                ...RECIPE_PAYLOAD,
                visibility: 'private',
            });

            expect(locked.status).toBe(423);
            expect(unaffected.status).toBe(201);
        });

        it('⛔ is REPEATABLE — a completed reset does not block the next one (no one-shot 410)', async () => {
            const first = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));
            await pool.query(`UPDATE test_reset_jobs SET status = 'completed' WHERE id = $1`, [first.body['jobId']]);

            const next = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));

            expect(next.status).toBe(202);
            expect(next.body['jobId']).not.toBe(first.body['jobId']);
        });

        it('⛔ is a 404 to a signed test principal the REGISTRY does not hold — the claim alone never purges', async () => {
            // The first request registers it; the row is then removed, and the process memo keeps the middleware from
            // re-registering — the same state a failed registry write leaves behind.
            await call('GET', '/api/v1/recipes', bearer(UNREGISTERED_TEST_USER, true));
            await pool.query('DELETE FROM test_principals WHERE user_id = $1', [UNREGISTERED_TEST_USER]);

            const response = await call('POST', '/api/v1/account/test-reset', bearer(UNREGISTERED_TEST_USER, true));

            expect(response.status).toBe(404);
            const jobs = await pool.query('SELECT 1 FROM test_reset_jobs WHERE user_id = $1', [UNREGISTERED_TEST_USER]);
            expect(jobs.rows).toHaveLength(0);
        });
    });

    describe('GET /api/v1/account/test-reset/{jobId}', () => {
        it('answers the principal’s own job', async () => {
            const accepted = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));

            const response = await call(
                'GET',
                `/api/v1/account/test-reset/${String(accepted.body['jobId'])}`,
                bearer(TEST_USER, true),
            );

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ jobId: accepted.body['jobId'], status: 'queued' });
        });

        it('⛔ is a 404 to a real user even for a job id that exists, and for a malformed id — never a 400', async () => {
            const accepted = await call('POST', '/api/v1/account/test-reset', bearer(TEST_USER, true));

            const foreign = await call(
                'GET',
                `/api/v1/account/test-reset/${String(accepted.body['jobId'])}`,
                bearer(REAL_USER, false),
            );
            const malformed = await call('GET', '/api/v1/account/test-reset/not-a-uuid', bearer(REAL_USER, false));

            expect(foreign.status).toBe(404);
            expect(malformed.status).toBe(404);
        });
    });
});
