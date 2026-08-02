/**
 * CR-002 / U4a — `POST /api/v1/internal/account/erasure` (the GREENFIELD service-principal erasure path)
 * against the REAL stack: a booted Nest app + Docker Postgres + LocalStack SQS, with a genuinely
 * EdDSA-signed service token verified end to end (no mocks) by the real `ServiceErasureAuthService`.
 *
 * This is the security GATE. The unit tiers pin the verifier, guard, service, and controller in isolation;
 * only the real stack proves the pieces are WIRED such that:
 *
 *   - the internal route is EXCLUDED from the Clerk `AuthMiddleware` yet still protected — an unauthenticated
 *     or forged/expired/wrong-audience token is rejected `401` and erases NOTHING (no row, no message);
 *   - a valid single-target token erases ONLY its bound owner (the target comes from the token, and there
 *     is no body to override it), recording the R8 audit fields (`trigger_source='service'`, `actor`,
 *     `confirmed_at`) on the durable row and enqueuing exactly one delete-everything message;
 *   - the two auth surfaces do not cross: a Clerk USER token is rejected on the internal route, and a
 *     service token is rejected on the user route.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
    DeleteMessageCommand,
    ReceiveMessageCommand,
    SQSClient,
    type Message as SqsMessage,
} from '@aws-sdk/client-sqs';
import { SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS, type AccountErasureMessage } from '@kitchensink/recipe-core';
import { eq } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_ERASURE_QUEUE_URL } from '../../../tests/global-setup.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { accountErasureJobs } from '../../../src/database/schema/account.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE } from '../../../src/account/dto/erasure.dto.js';
import {
    generateServiceKeypair,
    signServiceErasureToken,
    type ServiceKeypair,
} from '../../../tests/support/service-token.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';

/** The bound target owner the valid service token authorizes erasing. Distinct from any other suite's owner. */
const OWNER = '01JSVCERASUREOWNER000000AA';
/** A SECOND bound target, proving a token erases only ITS owner. */
const OTHER_OWNER = '01JSVCERASUREOWNER000000BB';

/** The `202` body of the service route. */
interface ServiceAcceptedBody {
    jobId?: string;
    status: string;
    triggerSource: string;
}

/** A persisted job row, including the R8 audit columns. */
interface JobRow {
    id: string;
    ownerId: string;
    status: string;
    triggerSource: string;
    actor: string | null;
    confirmedAt: Date | null;
    publishRecipeIds: string[] | null;
}

describe.skipIf(!hasDatabaseUrl)('service-principal account erasure (CR-002 / U4a integration GATE)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;
    let sqs: SQSClient;
    let trusted: ServiceKeypair;

    beforeAll(async () => {
        // Lift the (misconfigured) cross-cutting 10/min cap off this suite — same rationale as the sibling
        // erasure integration spec. Set BEFORE bootRecipeApp reads env on its dynamic AppModule import.
        process.env['RATE_LIMIT_PHOTO_UPLOAD'] = '1000';

        // The keypair the SERVICE is configured to trust: its PUBLIC key becomes the verification key, so
        // the real ServiceErasureAuthService verifies tokens this suite signs with the matching private key.
        trusted = await generateServiceKeypair();
        process.env['RECIPE_SERVICE_PRINCIPAL_JWT_KEY'] = trusted.publicKeyPem;

        booted = await bootRecipeApp();
        baseUrl = booted.baseUrl;
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        await drainQueue();
    });

    afterEach(async () => {
        await db.delete(accountErasureJobs).where(eq(accountErasureJobs.ownerId, OWNER));
        await db.delete(accountErasureJobs).where(eq(accountErasureJobs.ownerId, OTHER_OWNER));
        await drainQueue();
    });

    afterAll(async () => {
        sqs?.destroy();
        await booted?.close();
    });

    /** Drain + delete every message on the erasure queue, returning the parsed bodies. */
    async function drainQueue(): Promise<AccountErasureMessage[]> {
        const drained: AccountErasureMessage[] = [];

        for (;;) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SEED_ERASURE_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 1,
                }),
            );
            const messages: SqsMessage[] = received.Messages ?? [];

            if (messages.length === 0) {
                return drained;
            }

            for (const message of messages) {
                drained.push(JSON.parse(message.Body ?? '{}') as AccountErasureMessage);
                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: SEED_ERASURE_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        }
    }

    /** POST to the internal service route with the given bearer token (or none). */
    const postServiceErasure = (bearer?: string): Promise<Response> =>
        fetch(`${baseUrl}/api/v1/internal/account/erasure`, {
            method: 'POST',
            headers: bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {},
        });

    /** Read every job row for the given owner, including the audit columns. */
    async function readJobs(ownerId: string): Promise<JobRow[]> {
        return db
            .select({
                id: accountErasureJobs.id,
                ownerId: accountErasureJobs.ownerId,
                status: accountErasureJobs.status,
                triggerSource: accountErasureJobs.triggerSource,
                actor: accountErasureJobs.actor,
                confirmedAt: accountErasureJobs.confirmedAt,
                publishRecipeIds: accountErasureJobs.publishRecipeIds,
            })
            .from(accountErasureJobs)
            .where(eq(accountErasureJobs.ownerId, ownerId));
    }

    describe('a valid single-target token', () => {
        it('erases ONLY the bound owner, records the R8 audit fields, and enqueues one delete-everything message', async () => {
            const token = await signServiceErasureToken(trusted.privateKeyPem, {
                ownerId: OWNER,
                eventId: 'evt_user_deleted_42',
                actor: 'identity-deletion-worker',
            });

            const response = await postServiceErasure(token);

            expect(response.status).toBe(202);
            const body = (await response.json()) as ServiceAcceptedBody;
            expect(body.status).toBe('queued');
            expect(body.triggerSource).toBe('service');

            // The durable row is scoped to the TOKEN's owner and carries the audit trail (R8).
            const jobs = await readJobs(OWNER);
            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.id).toBe(body.jobId);
            expect(jobs[0]?.triggerSource).toBe('service');
            expect(jobs[0]?.actor).toBe('identity-deletion-worker');
            expect(jobs[0]?.confirmedAt).toBeInstanceOf(Date);
            // No donate election on the service path (KTD-2 default delete): an explicit empty list.
            expect(jobs[0]?.publishRecipeIds).toEqual([]);

            // Exactly one delete-everything message for the bound owner.
            const messages = await drainQueue();
            expect(messages).toHaveLength(1);
            expect(messages[0]?.ownerId).toBe(OWNER);
            expect(messages[0]?.publishRecipeIds ?? []).toEqual([]);
        });

        it('erases ONLY its OWN bound owner — a token for OTHER_OWNER touches nothing of OWNER', async () => {
            const token = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OTHER_OWNER });

            const response = await postServiceErasure(token);

            expect(response.status).toBe(202);
            expect(await readJobs(OTHER_OWNER)).toHaveLength(1);
            // The unrelated owner is untouched — the capability is bound to exactly the token's `sub`.
            expect(await readJobs(OWNER)).toHaveLength(0);
        });
    });

    describe('the rejection GATE — a forged/absent/expired/wrong-aud token erases NOTHING', () => {
        it('rejects a request with NO bearer token — 401, no row, no message', async () => {
            const response = await postServiceErasure();

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
            expect(await drainQueue()).toHaveLength(0);
        });

        it('rejects a token signed by an UNTRUSTED key (forged) — 401, no row', async () => {
            const forgedKeypair = await generateServiceKeypair();
            const forged = await signServiceErasureToken(forgedKeypair.privateKeyPem, { ownerId: OWNER });

            const response = await postServiceErasure(forged);

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
            expect(await drainQueue()).toHaveLength(0);
        });

        it('rejects an EXPIRED token — 401, no row', async () => {
            const expired = await signServiceErasureToken(trusted.privateKeyPem, {
                ownerId: OWNER,
                expiresInSeconds: -60,
            });

            const response = await postServiceErasure(expired);

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
        });

        it('rejects a token with an over-window lifetime even if unexpired — 401, no row', async () => {
            const overWindow = await signServiceErasureToken(trusted.privateKeyPem, {
                ownerId: OWNER,
                expiresInSeconds: SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS + 600,
            });

            const response = await postServiceErasure(overWindow);

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
        });

        it('rejects a token minted for the WRONG audience — 401, no row', async () => {
            const wrongAud = await signServiceErasureToken(trusted.privateKeyPem, {
                ownerId: OWNER,
                audience: 'urn:commise:food-service:something',
            });

            const response = await postServiceErasure(wrongAud);

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
        });
    });

    describe('the two auth surfaces do not cross', () => {
        it('rejects a Clerk USER session token on the SERVICE route — 401 (it is not a service token)', async () => {
            const clerk = generateClerkKeypair();
            const userToken = mintToken(clerk.privateKeyPem, {
                sub: 'user_abc',
                azp: 'http://localhost:3000',
                externalId: OWNER,
            });

            const response = await postServiceErasure(userToken);

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
        });

        it('rejects a SERVICE token on the USER route — 401 (the Clerk middleware does not admit it)', async () => {
            const serviceToken = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OWNER });

            const response = await fetch(`${baseUrl}/api/v1/account/erasure`, {
                method: 'POST',
                headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
                body: JSON.stringify({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE }),
            });

            expect(response.status).toBe(401);
            expect(await readJobs(OWNER)).toHaveLength(0);
        });
    });
});
