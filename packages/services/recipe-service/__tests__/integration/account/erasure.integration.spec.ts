/**
 * T137 — `POST /v1/account/erasure` against the REAL stack (booted Nest app + Docker Postgres +
 * LocalStack SQS). The service half of the GDPR right-to-erasure path (C-007 / D7).
 *
 * Requirement → test map:
 *
 *   * C-007 "a first request enqueues a job" (`api.openapi.yaml` → `requestAccountErasure` → 202)
 *     → `describe('POST /v1/account/erasure over the wire')`
 *       → 'answers 202 — not the POST default 201 — and durably records a queued job'
 *       → 'sends exactly one real erasure message carrying the authenticated owner'
 *   * C-007 "duplicate while queued/running → 202 with the EXISTING job id, no second enqueue"
 *     → `describe('concurrent duplicate requests')`
 *       → 'settle to ONE job and ONE message, handing both callers the same job id'
 *       → 'are arbitrated by idx_erasure_jobs_active_owner, not by application code'
 *   * C-007 "after a completed job → 410 ALREADY_ERASED"
 *     → `describe('POST /v1/account/erasure over the wire')`
 *       → 'answers 410 with the contract ALREADY_ERASED body once a prior job completed'
 *   * `ErasureRequest.confirmationPhrase` REQUIRED (U7) — a mismatched, empty, or absent phrase → 400
 *     → `describe('POST /v1/account/erasure over the wire')`
 *       → 'answers 400 for a mismatched confirmation phrase without recording a job'
 *       → 'REJECTS a request with no body and no content-type with 400 — the phrase is required (U7)'
 *
 * **Scope — what this tier is FOR, and what it deliberately leaves alone.** The unit tier
 * (`src/account/__tests__/*`) already pins the C-007 outcome map, the phrase rules, the enqueue
 * ordering, and the DAL's `ON CONFLICT DO NOTHING` against a fake db — exhaustively, and faster. None of
 * that is re-asserted here. What is left is precisely the set of facts a mock CANNOT establish, which is
 * why every test below needs the real stack:
 *
 *   - **Real HTTP status codes.** `@HttpCode(HttpStatus.ACCEPTED)` and the `GoneException` →
 *     `ApiExceptionFilter` → `410` translation only exist over a real wire. A unit test calling
 *     `controller.requestErasure()` sees a resolved value, not a status, so a dropped `@HttpCode` (→ 201)
 *     or a filter that swallowed the 410 body would ship green.
 *   - **Real index arbitration.** The unit tier can only FAKE the insert conflict by scripting the fake
 *     db to return `undefined`. Only a real Postgres proves `idx_erasure_jobs_active_owner` actually
 *     arbitrates two genuinely concurrent inserts — i.e. that the partial index exists, has the right
 *     predicate, and that the DAL's `ON CONFLICT` target matches it.
 *   - **A real queue.** `createSqsErasureQueue` is a real `SQSClient`; only LocalStack proves the message
 *     it builds is actually accepted and readable, and that a duplicate request sends no second one.
 *
 * The worker half — the FK/cascade semantics of the erase itself, the dual-bucket S3 sweep, and the job
 * reaching `completed` — lives in `@kitchensink/recipe-workers`
 * (`__tests__/integration/erasure/account-erasure.integration.spec.ts`), because `recipe-service` does
 * not (and must not) depend on its own downstream consumer.
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
import { ACCOUNT_ALREADY_ERASED_CODE, type AccountErasureMessage } from '@kitchensink/recipe-core';
import { eq, sql } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_ERASURE_QUEUE_URL } from '../../../tests/global-setup.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { accountErasureJobs } from '../../../src/database/schema/account.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE } from '../../../src/account/dto/erasure.dto.js';

/** The dev-bypass owner ULID every request in this suite authenticates as. */
const OWNER = '01JERASUREHTTP0OWNER00000A';

/**
 * How many duplicate requests the concurrency test fires at once.
 *
 * More than two on purpose: the invariant under test holds for any N, and a wider fan-out makes a
 * genuine overlap at the database more likely (see the test's own note on what is and is not
 * deterministic here). Bounded well under the pg pool size so the requests are not serialised by
 * connection starvation — which would quietly turn this into a sequential test that still passed.
 */
const CONCURRENT_REQUESTS = 4;
/** The required confirmation body (U7) every happy-path request must carry to be accepted. */
const CONFIRMED = { confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE };

/** The `202` body shape (`ErasureRequestAcceptedResponse`). */
interface AcceptedBody {
    jobId: string;
    status: string;
}

/** The `410` body shape (the contract's `ALREADY_ERASED` error). */
interface GoneBody {
    code: string;
    message: string;
}

describe.skipIf(!hasDatabaseUrl)('account erasure HTTP + queue (T137 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;
    let sqs: SQSClient;

    beforeAll(async () => {
        // Lift the rate limit OFF this suite's subject. `POST /v1/account/erasure` is currently capped at
        // 10 requests/minute — verified empirically, the 11th returns 429 — because no controller in the
        // service applies `@Throttle`, so all three named groups in `throttle.config.ts` apply to every
        // route at once and the most restrictive (`RATE_LIMIT_PHOTO_UPLOAD`, default 10) governs. That is
        // a real misconfiguration (erasure's limit should not be the PHOTO-UPLOAD limit) but it is not
        // T137's subject, and a suite that silently contorted itself to stay under an unrelated
        // cross-cutting cap would hand the next person a mysterious 429. Set BEFORE `bootRecipeApp`,
        // which reads env when it dynamically imports `AppModule`.
        process.env['RATE_LIMIT_PHOTO_UPLOAD'] = '1000';

        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        // A queue left dirty by an earlier suite would be counted as this suite's messages.
        await drainQueue();
    });

    afterEach(async () => {
        // Each test owns its own precondition, so the owner's jobs AND the queue are reset between them.
        // Without the drain, one test's message would be counted by the next (`toHaveLength(1)` is only
        // meaningful against a known-empty queue).
        await db.delete(accountErasureJobs).where(eq(accountErasureJobs.ownerId, OWNER));
        await drainQueue();
    });

    afterAll(async () => {
        sqs?.destroy();
        await booted?.close();
    });

    /**
     * Receive and delete every message currently on the erasure queue.
     *
     * Drains until an empty receive rather than sleeping for an arbitrary interval: the service AWAITS
     * `SendMessage` before it answers the request, so by the time a `fetch` has resolved, every message
     * that request will ever send is already durably on the queue. The HTTP response IS the
     * synchronisation point — there is nothing to wait for, so nothing here guesses at a delay.
     *
     * Received messages are DELETED, not left to their visibility timeout: an un-deleted message would
     * reappear ~30s later and pollute whichever test happened to be running then.
     *
     * @returns Every drained message body, parsed.
     * @sideEffect Consumes messages from the LocalStack queue.
     */
    async function drainQueue(): Promise<AccountErasureMessage[]> {
        const drained: AccountErasureMessage[] = [];

        for (;;) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SEED_ERASURE_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    // Long-poll: returns the instant a message is available, and only waits out the second
                    // when the queue is genuinely empty. Not a sleep — it is waiting on a real condition.
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

    /** POST an erasure request. Omitting `body` sends no body and no content-type at all. */
    const postErasure = (body?: unknown): Promise<Response> =>
        fetch(`${baseUrl}/v1/account/erasure`, {
            method: 'POST',
            ...(body === undefined
                ? {}
                : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        });

    /** Read the owner's job rows straight from Postgres. */
    async function readJobs(): Promise<{ id: string; status: string }[]> {
        return db
            .select({ id: accountErasureJobs.id, status: accountErasureJobs.status })
            .from(accountErasureJobs)
            .where(eq(accountErasureJobs.ownerId, OWNER));
    }

    describe('POST /v1/account/erasure over the wire', () => {
        it('answers 202 — not the POST default 201 — and durably records a queued job', async () => {
            const response = await postErasure(CONFIRMED);

            // 202 is a contract term, and it is ONLY observable here: the unit tier calls the controller
            // method directly and never sees a status, so a dropped `@HttpCode` would ship green there.
            expect(response.status).toBe(202);

            const body = (await response.json()) as AcceptedBody;
            expect(body.status).toBe('queued');

            // The response's job id is a real, durable row — not an invented value.
            const jobs = await readJobs();
            expect(jobs).toEqual([{ id: body.jobId, status: 'queued' }]);
        });

        it('sends exactly one real erasure message carrying the authenticated owner', async () => {
            await postErasure(CONFIRMED);

            const messages = await drainQueue();

            // Proves the real SQSClient → LocalStack round trip: the adapter's message is genuinely
            // accepted and readable, and it is scoped to the TOKEN's owner (never a body-supplied one).
            expect(messages).toHaveLength(1);
            expect(messages[0]?.ownerId).toBe(OWNER);
            expect(Date.parse(messages[0]?.requestedAt ?? '')).not.toBeNaN();
        });

        it('answers 410 with the contract ALREADY_ERASED body once a prior job completed', async () => {
            await db.insert(accountErasureJobs).values({ ownerId: OWNER, status: 'completed' });

            const response = await postErasure(CONFIRMED);

            expect(response.status).toBe(410);
            expect(response.headers.get('content-type')).toContain('application/json');

            // The wire body, exactly as the contract declares it. The service raises a framework
            // `GoneException`; only a real request proves `ApiExceptionFilter` passes its body through
            // untouched instead of remapping it into the recipe-domain error envelope.
            const body = (await response.json()) as GoneBody;
            expect(body.code).toBe(ACCOUNT_ALREADY_ERASED_CODE);
            expect(body.message).toBe('Account has already been erased');

            // A terminal account is not re-queued: no new row, no message.
            expect(await readJobs()).toHaveLength(1);
            expect(await drainQueue()).toHaveLength(0);
        });

        it('answers 400 for a mismatched confirmation phrase without recording a job', async () => {
            const response = await postErasure({ confirmationPhrase: 'erase my data' });

            expect(response.status).toBe(400);

            // The rejection is real: nothing was written and nothing was queued. Asserting the absence is
            // the point — a 400 that still enqueued would erase an account that never confirmed.
            expect(await readJobs()).toHaveLength(0);
            expect(await drainQueue()).toHaveLength(0);
        });

        it('REJECTS a request with no body and no content-type with 400 — the phrase is required (U7)', async () => {
            // The most dangerous path: with no content-type there is no parsed body, so the DTO pipe has
            // nothing to validate — the request would slip past the pipe entirely. Only the SERVICE-level
            // gate (ErasureService requires the phrase) catches it, so a no-body request must 400 and
            // enqueue nothing. This is exactly the "irreversible erasure with no intent gate" the
            // confirmation requirement closes; a unit test passing `undefined` to the controller cannot
            // observe the real parser + pipe interaction.
            const response = await postErasure();

            expect(response.status).toBe(400);
            expect(await readJobs()).toHaveLength(0);
            expect(await drainQueue()).toHaveLength(0);
        });

        it('accepts the exact confirmation phrase and enqueues', async () => {
            const response = await postErasure({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE });

            expect(response.status).toBe(202);
            expect(await drainQueue()).toHaveLength(1);
        });
    });

    describe('concurrent duplicate requests', () => {
        it('settle to ONE job and ONE message, handing both callers the same job id', async () => {
            // Genuinely concurrent: N real in-flight HTTP requests, resolved together — NOT a sequential
            // loop, and NOT a mock scripted to report a conflict.
            //
            // Honest limitation: the OVERLAP is probabilistic. Nothing here forces the two inserts to
            // interleave inside Postgres, and no synchronisation point exists to force it without
            // reaching into the service's internals (a sleep would be banned and would prove nothing
            // anyway). What is NOT probabilistic is the invariant: however the requests interleave —
            // fully overlapped, or accidentally serialised — exactly one job and exactly one message must
            // exist, and every caller must be told the same job id. A serialised run therefore never
            // makes this test WRONG, only weaker; an overlapped run additionally proves the index
            // arbitrates. The deterministic proof that the index itself is real is the sibling test.
            const responses = await Promise.all(
                Array.from({ length: CONCURRENT_REQUESTS }, () => postErasure(CONFIRMED)),
            );

            expect(responses.map((response) => response.status)).toEqual(
                Array.from({ length: CONCURRENT_REQUESTS }, () => 202),
            );

            const bodies = (await Promise.all(responses.map((response) => response.json()))) as AcceptedBody[];
            const jobIds = new Set(bodies.map((body) => body.jobId));

            // C-007: a duplicate is not a conflict — every caller gets THE job that is doing the work.
            expect(jobIds.size).toBe(1);

            // Exactly one row survived the race: the partial unique index rejected the rest.
            const jobs = await readJobs();
            expect(jobs).toHaveLength(1);
            expect(jobIds).toContain(jobs[0]?.id);

            // ...and the losers did NOT enqueue. A second message would mean a second worker invocation
            // racing the first over the same owner's data.
            expect(await drainQueue()).toHaveLength(1);
        });

        it('are arbitrated by idx_erasure_jobs_active_owner, not by application code', async () => {
            const first = await postErasure(CONFIRMED);
            expect(first.status).toBe(202);

            // The deterministic half of the concurrency story. The test above cannot force an overlap, so
            // it cannot by itself distinguish "the index arbitrated" from "the requests happened to
            // serialise and the service's re-read covered it". This one settles that: a raw INSERT,
            // bypassing the DAL's `ON CONFLICT DO NOTHING`, MUST be rejected by the database itself.
            //
            // Drop the partial index (or widen its predicate past 'queued'/'running') and this fails —
            // while every mocked unit test stays green, because a fake db cannot enforce an index.
            await expect(
                db.execute(sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${OWNER}, 'queued')`),
            ).rejects.toMatchObject({
                // Drizzle wraps the driver failure — its own `.message` is a generic "Failed query: …", so
                // the meaningful proof is on `.cause`, the raw pg error. Asserting BOTH the SQLSTATE
                // (`23505` = unique_violation) AND the exact `constraint` name is what makes this test have
                // teeth: it fails not on "some error" but only when THIS partial index is what rejected the
                // insert. Drop/rename/widen `idx_erasure_jobs_active_owner` and `constraint` no longer
                // matches; make the write succeed and there is no rejection at all.
                cause: { code: '23505', constraint: 'idx_erasure_jobs_active_owner' },
            });

            // The index is PARTIAL: terminal rows are outside its predicate, so they coexist freely. That
            // is what lets a fresh job be enqueued after a failure — the C-007 retry, expressed by the
            // schema rather than by a status check in application code.
            await expect(
                db.execute(sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${OWNER}, 'failed')`),
            ).resolves.toBeDefined();
        });
    });
});
