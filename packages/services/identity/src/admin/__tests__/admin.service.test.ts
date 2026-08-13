/**
 * AdminService.reactivateUser unit tests (CR-002 U2 — admin-mediated recovery). A support agent verifies the
 * closed user out-of-band, then this endpoint clears the tombstone (status→active, deletedAt→null), writes the
 * R8 audit row, and enqueues a `reactivation` event so the deletion-worker calls Clerk `unbanUser` (the
 * public-ALB service holds no Clerk secret). Only a `tombstoned` account is recoverable — `erased` is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';

const reportDeletionEnqueueFailure = vi.fn();
vi.mock('../../queue/deletion-enqueue.error.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../queue/deletion-enqueue.error.js')>()),
    reportDeletionEnqueueFailure: (input: unknown) => reportDeletionEnqueueFailure(input),
}));

import { AdminService } from '../admin.service.js';
import type { AuthorizerContext } from '../../types/jwt.js';
import type { UserId } from '../../types/user.js';

/**
 * The admin caller every case below acts as.
 *
 * ⚠️ This was `as never`, and the cast was load-bearing in the wrong direction: `never` accepted the object at
 * the call sites AND made every read of it a type error, so `actor: adminCtx.userId` in the audit-row assertion
 * was checking a property of `never`. Nothing reported it because this spec sat outside the typecheck project.
 * Typed as the real `AuthorizerContext` now, so a change to that interface breaks this fixture instead of
 * silently passing. `UserId` is a server-side brand over `string`, hence the one narrow cast on that field
 * rather than a blanket cast on the object.
 */
const adminCtx: AuthorizerContext = {
    userId: '01HZZZZZZZZZZZZZZZZZZZZZZA' as UserId,
    clerkUserId: 'user_admin',
    email: 'admin@example.com',
    tokenType: 'user',
    scopes: ['admin:users'],
    permissions: [],
};

function makeSelectChain<T>(rows: T[]) {
    return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) };
}

function buildMocks(existing: Record<string, unknown> | undefined) {
    const setMock = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const db: any = {
        select: vi.fn().mockReturnValue(makeSelectChain(existing ? [existing] : [])),
        update: vi.fn().mockReturnValue({ set: setMock }),
        insert: vi.fn().mockReturnValue({ values: insertValues }),
        transaction: vi.fn((cb: (tx: any) => unknown) => cb(db)),
    };
    const sqs: any = { enqueueDeletion: vi.fn().mockResolvedValue(undefined) };

    return { db, sqs, setMock, insertValues, service: new AdminService(db, sqs) };
}

describe('AdminService.reactivateUser', () => {
    beforeEach(() => vi.clearAllMocks());

    it('clears the tombstone, writes an audit row, and enqueues a reactivation (unban) event', async () => {
        const { service, setMock, insertValues, sqs } = buildMocks({
            id: 'usr_01',
            identityId: 'user_abc',
            status: 'tombstoned',
        });

        const result = await service.reactivateUser('usr_01', adminCtx);

        const userSet = setMock.mock.calls.map((c: any[]) => c[0]).find((s: any) => s.status === 'active');
        expect(userSet).toBeDefined();
        expect(userSet.deletedAt).toBeNull();

        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'reactivation', triggerSource: 'admin', actor: adminCtx.userId }),
        );
        expect(sqs.enqueueDeletion).toHaveBeenCalledWith(
            expect.objectContaining({ identityId: 'user_abc', userId: 'usr_01', event: 'reactivation' }),
        );
        expect(result).toMatchObject({ sub: 'usr_01', status: 'active' });
    });

    it('throws NotFound when the user does not exist', async () => {
        const { service } = buildMocks(undefined);

        await expect(service.reactivateUser('missing', adminCtx)).rejects.toBeInstanceOf(NotFoundException);
    });

    // ⛔ THE UNBAN IS THE WHOLE POINT OF THIS ENDPOINT. The tombstone is cleared inside a transaction, so the
    // database says `active` the moment it commits — but the user cannot sign in until Clerk unbans them, and
    // only the deletion-worker can do that. A failed enqueue therefore leaves a user who is active in our
    // records and LOCKED OUT in reality. That used to be a `logger.warn`, which nothing alerts on, so the
    // support agent was told the recovery succeeded and the user kept calling back.
    it('PAGES when the reactivation enqueue fails, instead of warning about it', async () => {
        const { db, sqs } = buildMocks({ id: 'usr_1', identityId: 'user_1', status: 'tombstoned' });
        sqs.enqueueDeletion.mockRejectedValueOnce(new Error('AccessDenied'));
        const service = new AdminService(db, sqs);

        // The tombstone is already cleared and committed, so the recovery still reports success — what changes
        // is that the missing unban is now announced rather than swallowed.
        await expect(service.reactivateUser('usr_1', adminCtx)).resolves.toMatchObject({ status: 'active' });

        expect(reportDeletionEnqueueFailure).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'reactivation', userId: 'usr_1', identityId: 'user_1' }),
        );
    });

    it('rejects reactivating a non-tombstoned (active) account, and does not enqueue', async () => {
        const { service, sqs } = buildMocks({ id: 'usr_01', identityId: 'user_abc', status: 'active' });

        await expect(service.reactivateUser('usr_01', adminCtx)).rejects.toBeInstanceOf(ConflictException);
        expect(sqs.enqueueDeletion).not.toHaveBeenCalled();
    });

    it('refuses to reactivate an ERASED account (irreversible)', async () => {
        const { service, sqs } = buildMocks({ id: 'usr_01', identityId: 'user_abc', status: 'erased' });

        await expect(service.reactivateUser('usr_01', adminCtx)).rejects.toBeInstanceOf(ConflictException);
        expect(sqs.enqueueDeletion).not.toHaveBeenCalled();
    });
});
