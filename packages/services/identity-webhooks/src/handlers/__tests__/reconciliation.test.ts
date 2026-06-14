import type { ScheduledEvent, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks must be hoisted before imports ---

vi.mock('../../common/db.js', () => ({
    getDb: vi.fn(),
}));

vi.mock('../../common/identityClient.js', () => ({
    listUsers: vi.fn(),
}));

vi.mock('@kitchensink/identity-service/database/dao', () => {
    const upsertByIdentityId = vi.fn();
    const UserDAO = vi.fn().mockImplementation(function () {
        return { upsertByIdentityId, findByIdentityId: vi.fn() };
    });
    const AccountDAO = vi.fn().mockImplementation(function () {
        return { upsert: vi.fn().mockResolvedValue({ id: 'acct-1', tier: 'free' }) };
    });

    return { UserDAO, AccountDAO };
});

vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler } from '../reconciliation.js';
import { getDb } from '../../common/db.js';
import { listUsers } from '../../common/identityClient.js';
import { UserDAO } from '@kitchensink/identity-service/database/dao';
import { emitMetric, logger } from '../../common/observability.js';

type TestHandler = (event: ScheduledEvent, ctx: Context) => Promise<unknown>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockListIdpUsers = vi.mocked(listUsers);
const mockEmitMetric = vi.mocked(emitMetric);
const mockLogger = vi.mocked(logger);

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;
const makeEvent = (): ScheduledEvent => ({ id: 'sched-event-1', source: 'aws.events' }) as unknown as ScheduledEvent;

const idpUserNew = {
    id: 'user_new',
    emailAddresses: [{ id: 'ea_1', emailAddress: 'new@example.com' }],
    primaryEmailAddressId: 'ea_1',
    fullName: 'New User',
    imageUrl: 'https://example.com/new.jpg',
};

const idpUserExisting = {
    id: 'user_existing',
    emailAddresses: [{ id: 'ea_2', emailAddress: 'existing@example.com' }],
    primaryEmailAddressId: 'ea_2',
    fullName: 'Existing User',
    imageUrl: 'https://example.com/existing.jpg',
};

describe('reconciliation handler', () => {
    let upsertByIdentityIdMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
        process.env.IDP_SECRET_KEY = 'sk_test_abc';
        process.env.STAGE = 'test';

        mockGetDb.mockResolvedValue({} as never);

        // user_new → no existing row (upsert returns new row with createdAt === updatedAt)
        // user_existing → existing row (upsert returns row with createdAt < updatedAt)
        const now = new Date();
        const earlier = new Date(now.getTime() - 10_000);

        upsertByIdentityIdMock = vi.fn().mockImplementation(({ identityId }: { identityId: string }) => {
            if (identityId === 'user_new') {
                return Promise.resolve({ id: 'ulid_new', identityId, createdAt: now, updatedAt: now });
            }

            return Promise.resolve({ id: 'ulid_existing', identityId, createdAt: earlier, updatedAt: now });
        });

        const findByIdentityIdMock = vi.fn().mockImplementation((identityId: string) => {
            if (identityId === 'user_existing') {
                return Promise.resolve({ id: 'ulid_existing', identityId });
            }

            return Promise.resolve(undefined);
        });

        vi.mocked(UserDAO).mockImplementation(function () {
            return {
                upsertByIdentityId: upsertByIdentityIdMock,
                findByIdentityId: findByIdentityIdMock,
            } as never;
        });
    });

    it('pages IdP users and upserts each one', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);

        await handler(makeEvent(), makeContext());

        expect(upsertByIdentityIdMock).toHaveBeenCalledTimes(2);
        expect(upsertByIdentityIdMock).toHaveBeenCalledWith({
            identityId: 'user_new',
            email: 'new@example.com',
            name: 'New User',
            picture: 'https://example.com/new.jpg',
        });
        expect(upsertByIdentityIdMock).toHaveBeenCalledWith({
            identityId: 'user_existing',
            email: 'existing@example.com',
            name: 'Existing User',
            picture: 'https://example.com/existing.jpg',
        });
    });

    it('counts 1 inserted and 1 updated for 2 users (1 new, 1 existing)', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);

        await handler(makeEvent(), makeContext());

        expect(mockEmitMetric).toHaveBeenCalledWith('ReconciliationDrift', 1);
        expect(mockLogger.info).toHaveBeenCalledWith(
            'reconciliation complete',
            expect.objectContaining({ inserted: 1, updated: 1, total: 2 }),
        );
    });

    it('emits ReconciliationDrift metric with inserted count', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);

        await handler(makeEvent(), makeContext());

        expect(mockEmitMetric).toHaveBeenCalledWith('ReconciliationDrift', expect.any(Number));
    });

    it('logs reconciliation complete with inserted, updated, total', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);

        await handler(makeEvent(), makeContext());

        expect(mockLogger.info).toHaveBeenCalledWith(
            'reconciliation complete',
            expect.objectContaining({
                total: 2,
            }),
        );
    });

    it('throws when env vars are missing', async () => {
        delete process.env.DB_SECRET_ARN;

        await expect(handler(makeEvent(), makeContext())).rejects.toThrow();
    });

    it('handles empty IdP user list gracefully', async () => {
        mockListIdpUsers.mockResolvedValue([] as never);

        await handler(makeEvent(), makeContext());

        expect(upsertByIdentityIdMock).not.toHaveBeenCalled();
        expect(mockEmitMetric).toHaveBeenCalledWith('ReconciliationDrift', 0);
    });
});
