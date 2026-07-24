import type { ScheduledEvent, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks must be hoisted before imports ---

vi.mock('../../common/db.js', () => ({
    getDb: vi.fn(),
}));

vi.mock('../../common/identityClient.js', () => ({
    listUsers: vi.fn(),
}));

vi.mock('@kitchensink/identity-service/database/dao', () => ({
    UserDAO: vi.fn().mockImplementation(function () {
        return { findByIdentityId: vi.fn() };
    }),
}));

vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    captureProvisioningFailure: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

vi.mock('../../common/provisioning.js', () => ({
    buildProvisionDeps: vi.fn(() => ({})),
}));

vi.mock('@kitchensink/identity-utils', () => ({
    provisionCompleteUser: vi.fn(),
}));

import { handler as rawHandler } from '../reconciliation.js';
import { getDb } from '../../common/db.js';
import { listUsers } from '../../common/identityClient.js';
import { provisionCompleteUser } from '@kitchensink/identity-utils';
import { UserDAO } from '@kitchensink/identity-service/database/dao';
import { captureProvisioningFailure, emitMetric, logger } from '../../common/observability.js';
import { resetConfigCacheForTests } from '../../config/env.js';

const mockProvisionCompleteUser = vi.mocked(provisionCompleteUser);

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
    beforeEach(() => {
        vi.clearAllMocks();
        resetConfigCacheForTests();
        process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
        process.env.IDP_SECRET_KEY = 'sk_test_abc';
        process.env.STAGE = 'test';

        mockGetDb.mockResolvedValue({} as never);
        mockProvisionCompleteUser.mockResolvedValue({ kind: 'complete', user: { id: 'ulid_x' } } as never);

        // findByIdentityId drives the inserted-vs-updated count: user_existing already present, user_new not.
        const findByIdentityIdMock = vi.fn().mockImplementation((identityId: string) => {
            if (identityId === 'user_existing') {
                return Promise.resolve({ id: 'ulid_existing', identityId });
            }

            return Promise.resolve(undefined);
        });

        vi.mocked(UserDAO).mockImplementation(function () {
            return { findByIdentityId: findByIdentityIdMock } as never;
        });
    });

    it('provisions every IdP user through the shared routine with the placeholder policy', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);

        await handler(makeEvent(), makeContext());

        expect(mockProvisionCompleteUser).toHaveBeenCalledTimes(2);
        expect(mockProvisionCompleteUser).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                identityId: 'user_new',
                email: 'new@example.com',
                name: 'New User',
                displayName: 'New User',
                avatarUrl: 'https://example.com/new.jpg',
            }),
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
        expect(mockProvisionCompleteUser).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ identityId: 'user_existing', email: 'existing@example.com' }),
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
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

    it('emits ReconciliationDrift metric with the inserted count', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);

        await handler(makeEvent(), makeContext());

        expect(mockEmitMetric).toHaveBeenCalledWith('ReconciliationDrift', expect.any(Number));
    });

    it('missing DB_SECRET_ARN → fails fast on the typed config before listing IdP users', async () => {
        delete process.env.DB_SECRET_ARN;

        await expect(handler(makeEvent(), makeContext())).rejects.toThrow();
        expect(mockListIdpUsers).not.toHaveBeenCalled();
    });

    it('missing both IDP_SECRET_KEY and AUTH_SECRET_ARN → fails fast on the typed config', async () => {
        delete process.env.IDP_SECRET_KEY;

        await expect(handler(makeEvent(), makeContext())).rejects.toThrow();
        expect(mockListIdpUsers).not.toHaveBeenCalled();
    });

    it('reads DB_SECRET_ARN from the typed config (not requireEnv)', async () => {
        mockListIdpUsers.mockResolvedValue([]);

        await handler(makeEvent(), makeContext());

        expect(mockGetDb).toHaveBeenCalledWith('arn:aws:secretsmanager:us-east-1:123:secret:db');
    });

    it('continues past a genuinely failing user, signals it, and counts it as failed', async () => {
        mockListIdpUsers.mockResolvedValue([idpUserNew, idpUserExisting] as never);
        // user_new's provisioning throws a genuine DB error; user_existing succeeds.
        mockProvisionCompleteUser.mockImplementation((_deps, input) => {
            if ((input as { identityId: string }).identityId === 'user_new') {
                return Promise.reject(new Error('db unavailable'));
            }

            return Promise.resolve({ kind: 'complete', user: { id: 'ulid_x' } }) as never;
        });

        const res = (await handler(makeEvent(), makeContext())) as { failed: number; updated: number };

        // The whole run is NOT aborted by one bad user — the other still gets repaired.
        expect(mockProvisionCompleteUser).toHaveBeenCalledTimes(2);
        expect(res.failed).toBe(1);
        expect(res.updated).toBe(1);
        // R5: the genuine failure emits the distinct paging signal carrying the Clerk identity id.
        expect(vi.mocked(captureProvisioningFailure)).toHaveBeenCalledWith(expect.any(Error), 'user_new');
    });

    it('handles an empty IdP user list gracefully', async () => {
        mockListIdpUsers.mockResolvedValue([] as never);

        await handler(makeEvent(), makeContext());

        expect(mockProvisionCompleteUser).not.toHaveBeenCalled();
        expect(mockEmitMetric).toHaveBeenCalledWith('ReconciliationDrift', 0);
    });
});
