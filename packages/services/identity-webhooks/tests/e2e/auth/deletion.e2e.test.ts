import type { Context, ScheduledEvent, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provisionCompleteUser } from '@kitchensink/identity-utils';

import { CONFIG_ERROR_CODE, ConfigError, resetConfigCacheForTests } from '../../../src/config/env.js';

/**
 * E2E: identity-webhooks async Lambdas (deletion-worker + reconciliation).
 *
 * Covers:
 *   - deletion-worker: the `user.deleted` webhook (KTD-2) full erasure — resolve the app ULID, erase the
 *     identity row to `{id}` (status='erased', R10), then fan out the recipe + food legs; idempotent on a
 *     missing/already-erased user
 *   - reconciliation: ScheduledEvent → IdP list → DAO upsert; returns drift counts
 *
 * @implements REQ-017 REQ-025 REQ-026 REQ-IF-005 REQ-IF-010 REQ-CN-001
 *             FR-017 FR-025 FR-026 ARCH-012 ARCH-017 MOD-012 MOD-017
 */

const mockFindByIdentityId = vi.fn();
const mockPurgePrivateData = vi.fn().mockResolvedValue(undefined);
const mockUpsert = vi.fn().mockResolvedValue({ id: '01UPSERTED0000000000000000' });
const mockListUsers = vi.fn();
const mockEraseIdentityRow = vi.fn().mockResolvedValue(undefined);
const mockRunErasureFanout = vi.fn();
const mockProvisionCompleteUser = vi.mocked(provisionCompleteUser);

vi.mock('../../../src/common/db.js', () => ({
    getDb: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../src/common/identityClient.js', () => ({
    listUsers: mockListUsers,
    getUser: vi.fn(),
    deleteUser: vi.fn(),
    setExternalId: vi.fn(),
    banUser: vi.fn(),
    unbanUser: vi.fn(),
}));
vi.mock('../../../src/common/erase-identity.js', () => ({ eraseIdentityRow: mockEraseIdentityRow }));
vi.mock('../../../src/common/erasure-fanout.js', () => ({ runErasureFanout: mockRunErasureFanout }));
vi.mock('@kitchensink/identity-db', () => ({
    UserDAO: vi.fn(function () {
        return {
            findByIdentityId: mockFindByIdentityId,
            purgePrivateDataByIdentityId: mockPurgePrivateData,
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
    // The handlers memoize their parsed env via getConfig()/getWebhookConfig() (module-level cache,
    // simulating a Lambda cold start). Reset it before each test — including before re-seeding the env
    // below — so a "missing env" test isn't masked by a valid config an earlier test in this file
    // already warmed.
    resetConfigCacheForTests();
    process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:000:secret:db';
    process.env['AUTH_SECRET_ARN'] = 'sk_test_dummy';
    // The KTD-2 webhook fan-out config (the fan-out itself is mocked; getErasureFanoutConfig must resolve).
    process.env['SERVICE_ERASURE_SIGNING_KEY'] = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';
    process.env['RECIPE_SERVICE_BASE_URL'] = 'https://recipe.example.test';
    process.env['FOOD_SERVICE_BASE_URL'] = 'https://food.example.test';
    mockRunErasureFanout.mockResolvedValue({
        recipe: { service: 'recipe', ok: true, jobStatus: 'queued' },
        food: { service: 'food', ok: true, deletedRequesterRows: 0 },
    });
    mockProvisionCompleteUser.mockResolvedValue({
        kind: 'complete',
        user: { id: '01UPSERTED0000000000000000' },
    } as never);
});

afterEach(() => vi.clearAllMocks());

/**
 * `attributes` was `{} as Record<string, string>`, which is NOT an `SQSRecordAttributes`: that type requires
 * `ApproximateReceiveCount`, `SentTimestamp`, `SenderId` and `ApproximateFirstReceiveTimestamp`. The record was
 * therefore not assignable to `SQSRecord` (7 x TS2322) and this tier had no typecheck project to say so. Filled
 * in with the same four fields `src/handlers/__tests__/deletion-worker.test.ts` already supplies, and the return
 * type is annotated so a future omission fails here rather than being absorbed by inference.
 */
const makeSqsRecord = (body: object, id = 'msg-1'): SQSRecord => ({
    messageId: id,
    body: JSON.stringify(body),
    receiptHandle: `rh-${id}`,
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000:identity-deletions',
    awsRegion: 'us-east-1',
    messageAttributes: {},
    md5OfBody: '',
    attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1234567890',
        SenderId: 'sender-1',
        ApproximateFirstReceiveTimestamp: '1234567890',
    },
});

/**
 * `aws-lambda`'s `Handler` declares three parameters and returns `void | Promise<TResult>`, so invoking it the
 * way the runtime does — two arguments, then reading the resolved value — is a type error. Narrowed through the
 * same alias shape the typechecked unit specs in `src/handlers/__tests__/` use.
 */
type SqsTestHandler = (event: SQSEvent, context: Context) => Promise<SQSBatchResponse>;
type ScheduledTestHandler = (event: ScheduledEvent, context: Context) => Promise<unknown>;

/** @sideEffect Dynamically imports the deletion-worker module. */
const loadDeletionWorker = async (): Promise<SqsTestHandler> => {
    const { handler } = await import('../../../src/handlers/deletion-worker.js');

    return handler as unknown as SqsTestHandler;
};

/** @sideEffect Dynamically imports the reconciliation module. */
const loadReconciliation = async (): Promise<ScheduledTestHandler> => {
    const { handler } = await import('../../../src/handlers/reconciliation.js');

    return handler as unknown as ScheduledTestHandler;
};

describe('e2e: deletion-worker Lambda (user.deleted webhook = KTD-2 full erasure)', () => {
    it('erases the resolved identity (status=erased) and fans out recipe + food when the user is found', async () => {
        mockFindByIdentityId.mockResolvedValueOnce({
            id: '01USER000000000000000DELETE',
            identityId: 'user_delete_e2e',
            status: 'active',
        });
        const handler = await loadDeletionWorker();

        const event: SQSEvent = { Records: [makeSqsRecord({ identityId: 'user_delete_e2e' })] };
        await handler(event, ctx);

        expect(mockEraseIdentityRow).toHaveBeenCalledTimes(1);
        expect(mockEraseIdentityRow.mock.calls[0]![1]).toMatchObject({
            userId: '01USER000000000000000DELETE',
            triggerSource: 'admin',
        });
        expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
        expect(mockRunErasureFanout.mock.calls[0]![0]).toMatchObject({ userId: '01USER000000000000000DELETE' });
    });

    it('is idempotent when the identity is unknown (no erase, no fan-out, no error)', async () => {
        mockFindByIdentityId.mockResolvedValueOnce(undefined);
        const handler = await loadDeletionWorker();

        const event: SQSEvent = { Records: [makeSqsRecord({ identityId: 'user_missing_e2e' })] };
        await expect(handler(event, ctx)).resolves.toBeUndefined();

        expect(mockEraseIdentityRow).not.toHaveBeenCalled();
        expect(mockRunErasureFanout).not.toHaveBeenCalled();
    });

    it('processes multiple SQS records in one invocation, erasing + fanning out each', async () => {
        mockFindByIdentityId
            .mockResolvedValueOnce({ id: 'u1', identityId: 'user_a', status: 'active' })
            .mockResolvedValueOnce({ id: 'u2', identityId: 'user_b', status: 'active' })
            .mockResolvedValueOnce({ id: 'u3', identityId: 'user_c', status: 'active' });
        const handler = await loadDeletionWorker();

        const event: SQSEvent = {
            Records: [
                makeSqsRecord({ identityId: 'user_a' }, 'm1'),
                makeSqsRecord({ identityId: 'user_b' }, 'm2'),
                makeSqsRecord({ identityId: 'user_c' }, 'm3'),
            ],
        };
        await handler(event, ctx);

        expect(mockRunErasureFanout).toHaveBeenCalledTimes(3);
        expect(mockRunErasureFanout.mock.calls[0]![0]).toMatchObject({ userId: 'u1' });
        expect(mockRunErasureFanout.mock.calls[2]![0]).toMatchObject({ userId: 'u3' });
    });

    it('fails fast at cold start with a typed coded ConfigError when DB_SECRET_ARN is missing', async () => {
        delete process.env['DB_SECRET_ARN'];
        const handler = await loadDeletionWorker();

        const event: SQSEvent = { Records: [makeSqsRecord({ identityId: 'user_x' })] };
        const rejection = handler(event, ctx);

        // A genuine misconfig rejects the invocation with the grep-able coded error (not a bare ZodError),
        // and the message NAMES the offending var — the assertion that proves the fail-fast is real.
        await expect(rejection).rejects.toBeInstanceOf(ConfigError);
        await expect(rejection).rejects.toHaveProperty('code', CONFIG_ERROR_CODE);
        await expect(rejection).rejects.toThrow(/DB_SECRET_ARN/);
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

        const handler = await loadReconciliation();
        const result = await handler(makeScheduledEvent(), ctx);

        expect(result).toEqual({ inserted: 1, updated: 1, failed: 0, skipped: 0, total: 2 });
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

        const handler = await loadReconciliation();
        const result = await handler(makeScheduledEvent(), ctx);

        expect(result).toEqual({ inserted: 0, updated: 0, failed: 0, skipped: 0, total: 0 });
        expect(mockProvisionCompleteUser).not.toHaveBeenCalled();
    });

    it('returns zero counts when IdP has no users', async () => {
        mockListUsers.mockResolvedValueOnce([]);
        const handler = await loadReconciliation();

        const result = await handler(makeScheduledEvent(), ctx);

        expect(result).toEqual({ inserted: 0, updated: 0, failed: 0, skipped: 0, total: 0 });
        expect(mockFindByIdentityId).not.toHaveBeenCalled();
    });

    it('fails fast at cold start with a typed coded ConfigError when required env is missing', async () => {
        delete process.env['DB_SECRET_ARN'];
        delete process.env['AUTH_SECRET_ARN'];
        delete process.env['IDP_SECRET_KEY'];
        const handler = await loadReconciliation();

        const rejection = handler(makeScheduledEvent(), ctx);

        // Missing DB secret AND missing IdP secret both surface in one coded, grep-able rejection.
        await expect(rejection).rejects.toBeInstanceOf(ConfigError);
        await expect(rejection).rejects.toHaveProperty('code', CONFIG_ERROR_CODE);
        await expect(rejection).rejects.toThrow(/DB_SECRET_ARN/);
    });
});
