/**
 * AdminService.reactivateUser unit tests (CR-002 U2 — admin-mediated recovery). A support agent verifies the
 * closed user out-of-band, then this endpoint clears the tombstone (status→active, deletedAt→null), writes the
 * R8 audit row, and enqueues a `reactivation` event so the deletion-worker calls Clerk `unbanUser` (the
 * public-ALB service holds no Clerk secret). Only a `tombstoned` account is recoverable — `erased` is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';

import { AdminService } from '../admin.service.js';

const adminCtx = {
    userId: '01HZZZZZZZZZZZZZZZZZZZZZZA',
    clerkUserId: 'user_admin',
    email: 'admin@example.com',
    tokenType: 'user' as const,
    scopes: ['admin:users'],
    permissions: [],
} as never;

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
