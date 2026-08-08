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
}));
vi.mock('@kitchensink/identity-db', () => ({
    UserDAO: vi.fn().mockImplementation(function (db: unknown) {
        return { __isUserDao: true, db };
    }),
}));

import { withDb, withVerifiedWebhook } from '../handler-pipeline.js';
import { getDb } from '../db.js';
import { verifyWebhook } from '../svix.js';
import { UserDAO } from '@kitchensink/identity-db';
import { resetConfigCacheForTests } from '../../config/env.js';

const mockGetDb = vi.mocked(getDb);
const mockVerifyWebhook = vi.mocked(verifyWebhook);

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
    it('passes the verified event and resolved request id through to the inner handler', async () => {
        const verifiedPayload = { type: 'user.created', data: { id: 'user_1' }, object: 'event' as const };

        mockVerifyWebhook.mockReturnValue(verifiedPayload as never);

        const core = vi.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
        const wrapped = withVerifiedWebhook(core);

        const event = makeApiEvent(JSON.stringify(verifiedPayload), { 'svix-id': 'msg_1' });
        const context = makeContext();
        const result = await wrapped(event, context);

        expect(result).toEqual({ statusCode: 200, body: '{}' });
        expect(mockVerifyWebhook).toHaveBeenCalledWith(event.headers, event.body, 'whsec_test');
        expect(core).toHaveBeenCalledWith(
            event,
            context,
            expect.objectContaining({ payload: verifiedPayload, requestId: 'test-req-id' }),
        );
    });

    it('rejects an unverified payload with a 401 and never calls the inner handler', async () => {
        mockVerifyWebhook.mockImplementation(() => {
            throw new Error('Invalid signature');
        });

        const core = vi.fn();
        const wrapped = withVerifiedWebhook(core);

        const result = await wrapped(makeApiEvent('{}', {}), makeContext());

        expect(result).toEqual({ statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
        expect(core).not.toHaveBeenCalled();
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
