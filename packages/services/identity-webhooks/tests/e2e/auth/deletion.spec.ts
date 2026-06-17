import type { Context, ScheduledEvent, SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provisionCompleteUser } from '@kitchensink/identity-utils';

/**
 * E2E: identity-webhooks async Lambdas (deletion-worker + reconciliation).
 *
 * Covers:
 *   - deletion-worker: SQS event → DAO hard-delete (cascades account + profile); idempotent on missing user
 *   - reconciliation: ScheduledEvent → IdP list → DAO upsert; returns drift counts
 *
 * @implements REQ-017 REQ-025 REQ-026 REQ-IF-005 REQ-IF-010 REQ-CN-001
 *             FR-017 FR-025 FR-026 ARCH-012 ARCH-017 MOD-012 MOD-017
 */

const mockFindByIdentityId = vi.fn();
const mockHardDelete = vi.fn().mockResolvedValue(undefined);
const mockUpsert = vi.fn().mockResolvedValue({ id: '01UPSERTED0000000000000000' });
const mockListUsers = vi.fn();
const mockProvisionCompleteUser = vi.mocked(provisionCompleteUser);

vi.mock('../../../src/common/db.js', () => ({
    getDb: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../src/common/identityClient.js', () => ({
    listUsers: mockListUsers,
    getUser: vi.fn(),
    deleteUser: vi.fn(),
    setExternalId: vi.fn(),
}));
vi.mock('@kitchensink/identity-service/database/dao', () => ({
    UserDAO: vi.fn(function () {
        return {
            findByIdentityId: mockFindByIdentityId,
            hardDeleteByIdentityId: mockHardDelete,
            upsertByIdentityId: mockUpsert,
        };
    }),
    AccountDAO: vi.fn(function () {
        return {};
    }),
    recordOnce: vi.fn(),
}));
// reconciliation provisions each drifted user through the shared routine (its real DB behavior is
// proven by the identity-service Postgres integration test); findByIdentityId still drives the
// inserted-vs-updated split.
vi.mock('../../../src/common/provisioning.js', () => ({ buildProvisionDeps: vi.fn(() => ({})) }));
vi.mock('@kitchensink/identity-utils', () => ({ provisionCompleteUser: vi.fn() }));
vi.mock('../../../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    captureProvisioningFailure: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (e: T, c: unknown) => Promise<R>) => fn,
}));

const ctx = { getRemainingTimeInMillis: () => 25_000, awsRequestId: 'req-e2e-async' } as unknown as Context;

beforeEach(() => {
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000:secret:db';
    process.env.AUTH_SECRET_ARN = 'sk_test_dummy';
    mockProvisionCompleteUser.mockResolvedValue({
        kind: 'complete',
        user: { id: '01UPSERTED0000000000000000' },
    } as never);
});

afterEach(() => vi.clearAllMocks());

const makeSqsRecord = (body: object, id = 'msg-1') => ({
    messageId: id,
    body: JSON.stringify(body),
    receiptHandle: `rh-${id}`,
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000:identity-deletions',
    awsRegion: 'us-east-1',
    messageAttributes: {},
    md5OfBody: '',
    attributes: {} as Record<string, string>,
});

describe('e2e: deletion-worker Lambda', () => {
    it('hard-deletes user when found in DB', async () => {
        mockFindByIdentityId.mockResolvedValueOnce({
            id: '01USER000000000000000DELETE',
            identityId: 'user_delete_e2e',
        });
        const { handler } = await import('../../../src/handlers/deletion-worker.js');

        const event: SQSEvent = { Records: [makeSqsRecord({ identityId: 'user_delete_e2e' })] };
        await handler(event, ctx);

        expect(mockFindByIdentityId).toHaveBeenCalledWith('user_delete_e2e');
        expect(mockHardDelete).toHaveBeenCalledWith('user_delete_e2e');
    });

    it('is idempotent when user is already absent (no error, no delete)', async () => {
        mockFindByIdentityId.mockResolvedValueOnce(null);
        const { handler } = await import('../../../src/handlers/deletion-worker.js');

        const event: SQSEvent = { Records: [makeSqsRecord({ identityId: 'user_missing_e2e' })] };
        await expect(handler(event, ctx)).resolves.toBeUndefined();

        expect(mockHardDelete).not.toHaveBeenCalled();
    });

    it('processes multiple SQS records in one invocation', async () => {
        mockFindByIdentityId
            .mockResolvedValueOnce({ id: 'u1', identityId: 'user_a' })
            .mockResolvedValueOnce({ id: 'u2', identityId: 'user_b' })
            .mockResolvedValueOnce({ id: 'u3', identityId: 'user_c' });
        const { handler } = await import('../../../src/handlers/deletion-worker.js');

        const event: SQSEvent = {
            Records: [
                makeSqsRecord({ identityId: 'user_a' }, 'm1'),
                makeSqsRecord({ identityId: 'user_b' }, 'm2'),
                makeSqsRecord({ identityId: 'user_c' }, 'm3'),
            ],
        };
        await handler(event, ctx);

        expect(mockHardDelete).toHaveBeenCalledTimes(3);
        expect(mockHardDelete).toHaveBeenNthCalledWith(1, 'user_a');
        expect(mockHardDelete).toHaveBeenNthCalledWith(3, 'user_c');
    });

    it('fails fast with an envelope error when DB_SECRET_ARN is missing', async () => {
        delete process.env.DB_SECRET_ARN;
        const { handler } = await import('../../../src/handlers/deletion-worker.js');

        const event: SQSEvent = { Records: [makeSqsRecord({ identityId: 'user_x' })] };
        await expect(handler(event, ctx)).rejects.toThrow(/DELETION_WORKER_MISSING_ENV/);
    });
});

const makeScheduledEvent = (): ScheduledEvent =>
    ({
        id: 'evt-e2e-reconcile',
        version: '0',
        account: '000',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        detail: {},
    }) as unknown as ScheduledEvent;

describe('e2e: reconciliation Lambda', () => {
    it('inserts new users and updates existing ones, returning drift counts', async () => {
        mockListUsers.mockResolvedValueOnce([
            {
                id: 'user_drift_new',
                primaryEmailAddressId: 'e1',
                emailAddresses: [{ id: 'e1', emailAddress: 'new@example.com' }],
                fullName: 'New User',
                imageUrl: 'https://i/n.jpg',
            },
            {
                id: 'user_drift_existing',
                primaryEmailAddressId: 'e2',
                emailAddresses: [{ id: 'e2', emailAddress: 'old@example.com' }],
                fullName: 'Existing User',
                imageUrl: null,
            },
        ]);
        mockFindByIdentityId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'existing-internal-id', identityId: 'user_drift_existing' });

        const { handler } = await import('../../../src/handlers/reconciliation.js');
        const result = await handler(makeScheduledEvent(), ctx);

        expect(result).toEqual({ inserted: 1, updated: 1, failed: 0, total: 2 });
        expect(mockProvisionCompleteUser).toHaveBeenCalledTimes(2);
        expect(mockProvisionCompleteUser).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ identityId: 'user_drift_new', email: 'new@example.com' }),
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
    });

    it('skips users without a primary email', async () => {
        mockListUsers.mockResolvedValueOnce([
            {
                id: 'user_no_email',
                primaryEmailAddressId: 'missing',
                emailAddresses: [{ id: 'other', emailAddress: 'other@example.com' }],
                fullName: 'No Primary',
                imageUrl: null,
            },
        ]);

        const { handler } = await import('../../../src/handlers/reconciliation.js');
        const result = await handler(makeScheduledEvent(), ctx);

        expect(result).toEqual({ inserted: 0, updated: 0, failed: 0, total: 0 });
        expect(mockProvisionCompleteUser).not.toHaveBeenCalled();
    });

    it('returns zero counts when IdP has no users', async () => {
        mockListUsers.mockResolvedValueOnce([]);
        const { handler } = await import('../../../src/handlers/reconciliation.js');

        const result = await handler(makeScheduledEvent(), ctx);

        expect(result).toEqual({ inserted: 0, updated: 0, failed: 0, total: 0 });
        expect(mockFindByIdentityId).not.toHaveBeenCalled();
    });

    it('fails fast with envelope error when required env is missing', async () => {
        delete process.env.DB_SECRET_ARN;
        delete process.env.AUTH_SECRET_ARN;
        delete process.env.IDP_SECRET_KEY;
        const { handler } = await import('../../../src/handlers/reconciliation.js');

        await expect(handler(makeScheduledEvent(), ctx)).rejects.toThrow(/RECONCILIATION_MISSING_ENV/);
    });
});
