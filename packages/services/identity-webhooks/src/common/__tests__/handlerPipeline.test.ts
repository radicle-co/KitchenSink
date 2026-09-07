import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the Template-Method handler wrappers (S-I6). Mirrors the mocking conventions the
 * three handler unit tests already use (`getDb`, `UserDAO`, `verifyWebhook`, the observability
 * `logger`), so these prove the wrappers' own wiring in isolation from any handler.
 */

vi.mock('../db.js', () => ({ getDb: vi.fn() }));
vi.mock('../svix.js', () => ({ verifyWebhook: vi.fn() }));
vi.mock('../observability.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emitMetric: vi.fn(),
}));
vi.mock('@kitchensink/identity-db', () => ({
    UserDAO: vi.fn().mockImplementation(function (db: unknown) {
        return { __isUserDao: true, db };
    }),
}));

import { WEBHOOK_REJECTION_STATUS, withDb, withVerifiedWebhook } from '../handlerPipeline.js';
import { getDb } from '../db.js';
import { verifyWebhook } from '../svix.js';
import { emitMetric, logger } from '../observability.js';
import { UserDAO } from '@kitchensink/identity-db';
import { resetConfigCacheForTests } from '../../config/env.js';

const mockGetDb = vi.mocked(getDb);
const mockVerifyWebhook = vi.mocked(verifyWebhook);
const mockLogger = vi.mocked(logger);
const mockEmitMetric = vi.mocked(emitMetric);

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;

const makeApiEvent = (body: string, headers: Record<string, string> = {}): APIGatewayProxyEvent =>
    ({
        body,
        headers,
        requestContext: { requestId: 'test-req-id' },
    }) as unknown as APIGatewayProxyEvent;

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env['AUTH_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
    process.env['DELETION_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue';
    process.env['IDP_WEBHOOK_SECRET'] = 'whsec_test';
});

describe('withDb', () => {
    it('calls the inner handler with a resolved db/DAO context and returns the inner result', async () => {
        const fakeDb = { __isDb: true };

        mockGetDb.mockResolvedValue(fakeDb as never);

        const core = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = withDb(core);

        const event = { some: 'event' };
        const context = makeContext();
        const result = await wrapped(event, context);

        expect(result).toEqual({ ok: true });
        // The typed config is read (DB_SECRET_ARN) and handed straight to getDb — the warm-cached
        // connection factory, not a hand-rolled per-handler lookup.
        expect(mockGetDb).toHaveBeenCalledWith('arn:aws:secretsmanager:us-east-1:123:secret:db');
        expect(vi.mocked(UserDAO)).toHaveBeenCalledWith(fakeDb, expect.anything());
        expect(core).toHaveBeenCalledWith(
            event,
            context,
            expect.objectContaining({ db: fakeDb, userDao: expect.objectContaining({ __isUserDao: true }) }),
        );
    });

    it('propagates a config error coherently and never calls getDb or the inner handler', async () => {
        delete process.env['DB_SECRET_ARN'];

        const core = vi.fn();
        const wrapped = withDb(core);

        await expect(wrapped({}, makeContext())).rejects.toThrow();

        expect(mockGetDb).not.toHaveBeenCalled();
        expect(core).not.toHaveBeenCalled();
    });

    it('propagates a rejected getDb() without calling the inner handler', async () => {
        mockGetDb.mockRejectedValue(new Error('secret not found'));

        const core = vi.fn();
        const wrapped = withDb(core);

        await expect(wrapped({}, makeContext())).rejects.toThrow('secret not found');
        expect(core).not.toHaveBeenCalled();
    });
});

describe('withVerifiedWebhook', () => {
    /** A Clerk `user.created` payload that satisfies the boundary schema (email is required — NOT NULL column). */
    const validPayload = {
        type: 'user.created',
        object: 'event' as const,
        data: {
            id: 'user_1',
            email_addresses: [{ id: 'idn_1', email_address: 'ada@example.com' }],
            first_name: 'Ada',
            last_name: 'Lovelace',
            image_url: 'https://img.example.com/a.png',
        },
    };

    it('passes the verified event and resolved request id through to the inner handler', async () => {
        mockVerifyWebhook.mockReturnValue(validPayload as never);

        const core = vi.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
        const wrapped = withVerifiedWebhook(core);

        const event = makeApiEvent(JSON.stringify(validPayload), { 'svix-id': 'msg_1' });
        const context = makeContext();
        const result = await wrapped(event, context);

        expect(result).toEqual({ statusCode: 200, body: '{}' });
        expect(mockVerifyWebhook).toHaveBeenCalledWith(event.headers, event.body, 'whsec_test');
        expect(core).toHaveBeenCalledWith(
            event,
            context,
            expect.objectContaining({ payload: expect.objectContaining({ type: 'user.created' }) }),
        );
    });

    /**
     * The rejection contract: a signature failure and a shape failure are EQUALLY INVALID and take ONE path —
     * never process, alarm at ERROR, and report the reason as a FIELD — but they do NOT get the same STATUS,
     * because retrying helps exactly one of them.
     *
     *  - `shape` → **200**. The caller IS svix (the signature verified), and an unparseable payload parses
     *    identically on every redelivery, so retrying replays the same failure forever. Acknowledging takes it
     *    off svix's schedule.
     *  - `signature` → **401**. A signature failure is either not Clerk at all (in which case a 200 tells a
     *    forger their forgery was accepted) or OUR SIGNING SECRET IS WRONG — which is a transient,
     *    operator-fixable condition, and svix's multi-hour retry schedule is precisely what rescues it. A 200
     *    there means "delivered": every queued real Clerk event is discarded permanently behind a green
     *    acknowledgement. That is the recorded incident class — a dropped `user.created` leaving Clerk holding
     *    a user the database does not.
     *
     * `WEBHOOK_REJECTION_STATUS` is asserted directly as well as through the pipeline, so the mapping cannot
     * be inverted or collapsed without reding a test. Each `it` below is a separate mutation guard, because the
     * halves regress independently:
     *  - collapsing the two statuses back onto one re-creates either the retry loop (shape) or the silent-drop
     *    (signature);
     *  - dropping the ERROR log turns "do not retry" into "fail silently", which is strictly worse;
     *  - dropping the `reason` field makes the alarm unactionable — it is what lets signature noise from this
     *    public endpoint be thresholded separately from a Clerk contract change.
     */
    describe.each([
        [
            'signature',
            401,
            (): void => {
                mockVerifyWebhook.mockImplementation(() => {
                    throw new Error('Invalid signature');
                });
            },
        ],
        [
            'shape',
            200,
            (): void => {
                // A VALID signature over a payload we cannot read: no `id`. Previously this sailed through as
                // `?? 'unknown'` and was written to `webhook_events.identity_id`.
                mockVerifyWebhook.mockReturnValue({ type: 'user.created', data: {} } as never);
            },
        ],
    ])('an invalid payload (reason: %s)', (reason, expectedStatus, arrange) => {
        beforeEach(arrange);

        it(`answers ${expectedStatus} and never calls the inner handler`, async () => {
            const core = vi.fn();

            const result = await withVerifiedWebhook(core)(makeApiEvent('{}', { 'svix-id': 'msg_bad' }), makeContext());

            // The status is DERIVED from the reason. A `shape` 200 stops svix redelivering a payload that can
            // never succeed; a `signature` 401 keeps the delivery on svix's retry schedule so a rotated-secret
            // misconfiguration is recoverable instead of silently dropping every real event.
            expect(result.statusCode).toBe(expectedStatus);
            expect(JSON.parse(result.body)).toEqual({ ok: false, rejected: reason });
            expect(core).not.toHaveBeenCalled();
        });

        it('logs at ERROR with the reason and the svix id (not silently dropped)', async () => {
            await withVerifiedWebhook(vi.fn())(makeApiEvent('{}', { 'svix-id': 'msg_bad' }), makeContext());

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('rejected invalid payload'),
                expect.objectContaining({ reason, svixId: 'msg_bad' }),
            );
        });

        it('emits a rejection metric dimensioned BY reason', async () => {
            await withVerifiedWebhook(vi.fn())(makeApiEvent('{}', { 'svix-id': 'msg_bad' }), makeContext());

            expect(mockEmitMetric).toHaveBeenCalledWith('IdentityWebhookRejected', 1, { reason });
        });

        it('never logs the raw body, which carries the email address and legal name', async () => {
            await withVerifiedWebhook(vi.fn())(
                makeApiEvent(JSON.stringify({ data: { email_addresses: [{ email_address: 'ada@example.com' }] } }), {
                    'svix-id': 'msg_bad',
                }),
                makeContext(),
            );

            const logged = JSON.stringify(mockLogger.error.mock.calls);
            expect(logged).not.toContain('ada@example.com');
        });
    });

    /**
     * The mapping itself, asserted directly rather than only through the pipeline.
     *
     * The pipeline tests above would still pass if BOTH reasons were mapped to the same status and the test
     * table were "corrected" to match — this one cannot, because it names the retry semantics each value
     * carries. A `signature` 2xx tells svix "delivered" and discards every queued real event when the failure
     * cause is a stale secret; a `shape` non-2xx puts a permanently unparseable delivery on a multi-hour retry
     * schedule. The two are opposite mistakes, so neither is a safe default for the other.
     */
    describe('WEBHOOK_REJECTION_STATUS', () => {
        it('keeps a signature failure RETRYABLE (non-2xx) so a stale signing secret is recoverable', () => {
            expect(WEBHOOK_REJECTION_STATUS.signature).toBe(401);
            expect(WEBHOOK_REJECTION_STATUS.signature).toBeGreaterThanOrEqual(400);
        });

        it('makes a shape failure TERMINAL (2xx) so an unparseable payload is not redelivered forever', () => {
            expect(WEBHOOK_REJECTION_STATUS.shape).toBe(200);
            expect(WEBHOOK_REJECTION_STATUS.shape).toBeLessThan(300);
        });

        it('never collapses the two reasons onto one status', () => {
            expect(WEBHOOK_REJECTION_STATUS.signature).not.toBe(WEBHOOK_REJECTION_STATUS.shape);
        });
    });

    it('rejects a payload whose ONLY defect is a missing id — no sentinel fallback', async () => {
        // Isolates `id` specifically: everything else is valid, so this reds if and only if `id` stops being
        // required (or a `?? 'unknown'` fallback comes back). The generic shape case above cannot prove this,
        // because its payload is missing several fields at once. `id` matters more than the others: it is the
        // row key for the user about to be written, and for `user.deleted` it keys a DELETE.
        const { id: _omitted, ...dataWithoutId } = validPayload.data;

        mockVerifyWebhook.mockReturnValue({ ...validPayload, data: dataWithoutId } as never);

        const core = vi.fn();
        const result = await withVerifiedWebhook(core)(makeApiEvent('{}', { 'svix-id': 'msg_1' }), makeContext());

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ ok: false, rejected: 'shape' });
        expect(core).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ issues: expect.arrayContaining([expect.stringContaining('data.id')]) }),
        );
    });

    it('rejects a user.deleted whose id is missing — a DELETE must never key on a fabricated id', async () => {
        mockVerifyWebhook.mockReturnValue({ type: 'user.deleted', data: {} } as never);

        const core = vi.fn();
        const result = await withVerifiedWebhook(core)(makeApiEvent('{}', { 'svix-id': 'msg_1' }), makeContext());

        expect(JSON.parse(result.body)).toEqual({ ok: false, rejected: 'shape' });
        expect(core).not.toHaveBeenCalled();
    });

    it('accepts a user.deleted carrying ONLY an id (Clerk sends no full user on a deletion)', async () => {
        // The counterpart: requiring an email on `user.deleted` would reject every real deletion. This is why
        // the schema is a discriminated union rather than one shape per event.
        mockVerifyWebhook.mockReturnValue({ type: 'user.deleted', data: { id: 'user_1' } } as never);

        const core = vi.fn().mockResolvedValue({ statusCode: 200, body: '{}' });

        await withVerifiedWebhook(core)(makeApiEvent('{}', { 'svix-id': 'msg_1' }), makeContext());

        expect(core).toHaveBeenCalled();
    });

    it('logs the rejection at ERROR severity specifically, not info/warn', async () => {
        // Severity is load-bearing, not cosmetic: the Sentry log drain classifies records by matching the
        // message text, so a downgrade to info/warn silently stops this surfacing as a Sentry ERROR — turning
        // "do not retry" into the silent drop the whole path exists to avoid. Reds on a severity downgrade.
        mockVerifyWebhook.mockImplementation(() => {
            throw new Error('Invalid signature');
        });

        await withVerifiedWebhook(vi.fn())(makeApiEvent('{}', { 'svix-id': 'msg_bad' }), makeContext());

        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('reports a shape failure with zod issue PATHS, so it is diagnosable without the body', async () => {
        mockVerifyWebhook.mockReturnValue({ type: 'user.created', data: { id: 'user_1' } } as never);

        await withVerifiedWebhook(vi.fn())(makeApiEvent('{}', { 'svix-id': 'msg_1' }), makeContext());

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                reason: 'shape',
                // The missing field is named by PATH, which is what tells an operator that Clerk stopped
                // sending email addresses — the diagnosis the whole rejection path exists to deliver.
                issues: expect.arrayContaining([expect.stringContaining('data.email_addresses')]),
            }),
        );
    });

    it('treats an UNHANDLED event type as a quiet 200, not an alarm', async () => {
        // Widening the Clerk dashboard's subscription list must not page anyone. Unhandled and invalid are
        // different: this is "not our business", not "Clerk's contract moved".
        mockVerifyWebhook.mockReturnValue({ type: 'session.created', data: { id: 'sess_1' } } as never);

        const core = vi.fn();
        const result = await withVerifiedWebhook(core)(makeApiEvent('{}', { 'svix-id': 'msg_1' }), makeContext());

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ ok: true, unhandled: 'session.created' });
        expect(core).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('fails fast on a webhook config error, before verifying the signature', async () => {
        delete process.env['IDP_WEBHOOK_SECRET'];

        const core = vi.fn();
        const wrapped = withVerifiedWebhook(core);

        await expect(wrapped(makeApiEvent('{}', {}), makeContext())).rejects.toThrow();

        expect(mockVerifyWebhook).not.toHaveBeenCalled();
        expect(core).not.toHaveBeenCalled();
    });
});
