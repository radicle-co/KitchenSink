import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

const reportDeletionEnqueueFailure = vi.fn();
vi.mock('../src/queue/deletionEnqueue.error.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/queue/deletionEnqueue.error.js')>()),
    reportDeletionEnqueueFailure: (input: unknown) => reportDeletionEnqueueFailure(input),
}));

vi.mock('pg', () => {
    const mockPool = { connect: vi.fn(), query: vi.fn(), end: vi.fn() };

    return { default: { Pool: vi.fn(() => mockPool) } };
});

function makeChain<T>(result: T) {
    return {
        from: () => ({
            where: () => ({
                limit: () => Promise.resolve(result),
            }),
        }),
    };
}

const adminCtx = {
    userId: '01HZZZZZZZZZZZZZZZZZZZZZZA' as const,
    clerkUserId: 'user_admin123',
    email: 'admin@example.com',
    tokenType: 'user' as const,
    scopes: ['admin:users'],
    permissions: [],
};

const userCtx = {
    userId: '01HZZZZZZZZZZZZZZZZZZZZZZU' as const,
    clerkUserId: 'user_abc123',
    email: 'test@example.com',
    tokenType: 'user' as const,
    scopes: [],
    permissions: [],
};

const mockUser = {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZU',
    clerkId: 'user_abc123',
    email: 'test@example.com',
    status: 'active',
    name: null,
    picture: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
};

describe('UsersService', () => {
    let usersService: any;
    let mockDb: any;
    let mockSqs: any;
    let mockResolver: any;
    let mockAvatarStore: any;

    beforeEach(async () => {
        vi.resetModules();

        mockDb = {
            select: vi.fn(),
            insert: vi.fn(),
            delete: vi.fn().mockReturnValue({ where: () => Promise.resolve() }),
            update: vi.fn().mockReturnValue({
                set: () => ({ where: () => Promise.resolve() }),
            }),
            // Raw-statement escape hatch. Needed because `provisionCompleteUser` opens its transaction with a
            // per-identity `pg_advisory_xact_lock` — the fix for the `40P01` speculative-insertion deadlock
            // between the `identity_id` arbiter and `users_email_unique` (see
            // `packages/utils/identity/src/provisioning.ts`). Swallowed here; the lock's presence and its
            // position BEFORE the upsert are asserted in that package's own unit suite.
            execute: vi.fn().mockResolvedValue([]),
            // Delegate the transaction callback to mockDb so per-test insert/select/delete stubs apply,
            // and RETURN its result (upsertUserRecord returns the created row from inside the tx).
            transaction: vi.fn((cb: (tx: any) => unknown) => cb(mockDb)),
        };

        mockSqs = { enqueueDeletion: vi.fn().mockResolvedValue(undefined) };
        mockAvatarStore = { deleteAllForUser: vi.fn().mockResolvedValue(undefined) };
        mockResolver = {
            resolveUser: vi.fn().mockResolvedValue({
                user: mockUser,
                account: {
                    id: 'a-1',
                    userId: '01HZZZZZZZZZZZZZZZZZZZZZZU',
                    subscriptionTier: 'free',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            }),
        };

        const { UsersService } = await import('../src/users/users.service.js');

        usersService = new UsersService(mockDb, mockSqs, mockResolver, noopHandleSyncPublisher, mockAvatarStore);
    });

    it('getUserMe returns aggregated profile', async () => {
        const profile = {
            id: 'p-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZU',
            displayName: 'Test',
            avatarUrl: null,
            bio: null,
            updatedAt: new Date(),
        };
        const account = {
            id: 'a-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZU',
            subscriptionTier: 'free',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        mockResolver.resolveUser.mockResolvedValue({ user: mockUser, account });
        mockDb.select = vi.fn().mockReturnValueOnce(makeChain([profile]));

        const result = await usersService.getUserMe(userCtx);

        expect(result.user.id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZU');
        expect(result.account.subscriptionTier).toBe('free');
    });

    it('getUserMe throws when user missing', async () => {
        mockResolver.resolveUser.mockRejectedValue(new Error('User not found'));

        await expect(usersService.getUserMe(userCtx)).rejects.toThrow();
    });

    it('upsertUser creates user via clerkId and returns ULID id', async () => {
        const newUser = { ...mockUser, id: '01HZZZZZZZZZZZZZZZZZZZZZZU' };

        mockDb.insert = vi.fn().mockReturnValue({
            values: () => ({
                onConflictDoUpdate: () => ({
                    returning: () => Promise.resolve([newUser]),
                }),
                onConflictDoNothing: () => Promise.resolve(),
            }),
        });

        const result = await usersService.upsertUser(userCtx, {
            clerkId: 'user_abc123',
            email: 'test@example.com',
            name: 'Test User',
        });

        expect(result.id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZU');
        // createdAt === updatedAt on the returned row signals a first-time insert (see UsersService.upsertUser).
        expect(result.created).toBe(true);
    });

    it('deleteUserMe tombstones (closure): scrubs email+avatar, keeps the row, and enqueues a closure ban', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        const setMock = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
        mockDb.update = vi.fn().mockReturnValue({ set: setMock });
        const insertValues = vi.fn().mockResolvedValue(undefined);
        mockDb.insert = vi.fn().mockReturnValue({ values: insertValues });

        await usersService.deleteUserMe(userCtx);

        // The users row is UPDATEd (never deleted — R1) to the tombstoned closure state with a scrubbed email.
        const userSet = setMock.mock.calls.map((c: any[]) => c[0]).find((s: any) => s.status === 'tombstoned');
        expect(userSet).toBeDefined();
        expect(userSet.email).toContain('@closed.invalid');
        expect(userSet.picture).toBeNull();
        expect(userSet.deletedAt).toBeInstanceOf(Date);

        // R8 audit row written for the closure transition (trigger = user self-service).
        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'closure', triggerSource: 'user', userId: userCtx.userId }),
        );

        // The avatar S3 object is deleted, and the Clerk BAN is handed to the deletion-worker as a closure event.
        expect(mockAvatarStore.deleteAllForUser).toHaveBeenCalledWith(userCtx.userId);
        expect(mockSqs.enqueueDeletion).toHaveBeenCalledWith(
            expect.objectContaining({ identityId: 'user_abc123', userId: userCtx.userId, event: 'closure' }),
        );
    });

    it('deleteUserMe closure still succeeds when the avatar S3 delete fails (best-effort)', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        mockDb.update = vi.fn().mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockAvatarStore.deleteAllForUser.mockRejectedValue(new Error('s3 down'));

        await expect(usersService.deleteUserMe(userCtx)).resolves.toMatchObject({ sub: userCtx.userId });
        expect(mockSqs.enqueueDeletion).toHaveBeenCalled();
    });

    // ⛔ THE BAN IS THE SECURITY CONTROL, NOT A NICETY. The transaction has already tombstoned the row, so the
    // database says the account is closed — but the Clerk session is untouched until the deletion-worker bans
    // the identity, and only that Lambda holds the Clerk secret. A swallowed enqueue therefore leaves an
    // account the user believes is closed still minting fresh JWTs, with nothing recorded anywhere. This used
    // to be `logger.warn('Failed to enqueue closure ban')`, which is how it went unnoticed that the deployed
    // task role had no `sqs:SendMessage` grant at all and EVERY enqueue was failing.
    it('deleteUserMe PAGES when the closure ban cannot be enqueued, instead of warning about it', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        mockDb.update = vi.fn().mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockSqs.enqueueDeletion.mockRejectedValueOnce(new Error('AccessDenied'));

        await expect(usersService.deleteUserMe(userCtx)).resolves.toMatchObject({ sub: userCtx.userId });

        expect(reportDeletionEnqueueFailure).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'closure', userId: userCtx.userId, identityId: 'user_abc123' }),
        );
    });

    it('deleteUserMe throws when user missing', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([]));

        await expect(usersService.deleteUserMe(userCtx)).rejects.toThrow('User not found');
    });

    it('patchUserMe updates profile fields', async () => {
        const updatedProfile = {
            id: 'p-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZU',
            displayName: 'New Name',
            avatarUrl: null,
            updatedAt: new Date(),
        };
        const updatedAccount = {
            id: 'a-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZU',
            subscriptionTier: 'free',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(makeChain([mockUser]))
            .mockReturnValueOnce(makeChain([updatedProfile]))
            .mockReturnValueOnce(makeChain([updatedAccount]));

        mockDb.update = vi.fn().mockReturnValue({
            set: () => ({ where: () => Promise.resolve() }),
        });

        const result = await usersService.patchUserMe(userCtx, { displayName: 'New Name' });

        expect(result.user.displayName).toBe('New Name');
    });

    /**
     * Account ERASURE (plan U2) — the irreversible sibling of `deleteUserMe`'s recoverable closure.
     *
     * ⛔ Why this endpoint has to exist at all. The app's "erase my data" control reached the RECIPE
     * service and nothing else, so an erasure left the identity row, the Clerk account, the avatar object
     * and food's requester rows all intact — the user could sign straight back in to an account they had
     * been told was destroyed. Recipe cannot fix this from its side: it holds no Clerk secret and does not
     * own the user. Identity does, so identity is where the account-level erasure is initiated.
     *
     * Identity still cannot call Clerk itself (it runs behind a public ALB and holds no secret — the same
     * reason closure hands the BAN to the deletion-worker), so the Clerk delete is the worker's job. What
     * identity owns is: scrub its own row, write the R8 audit, drop the avatar, and enqueue the one message
     * that drives everything downstream.
     */
    it('eraseUserMe scrubs the row to erased, writes an erasure audit row, and enqueues the erasure event', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        const setMock = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
        mockDb.update = vi.fn().mockReturnValue({ set: setMock });
        const insertValues = vi.fn().mockResolvedValue(undefined);
        mockDb.insert = vi.fn().mockReturnValue({ values: insertValues });

        await usersService.eraseUserMe(userCtx);

        // ERASED, not tombstoned — the distinction is what brings the row under the R10 anti-resurrection
        // guard, so a token minted before the Clerk delete cannot read-through-create the user again.
        const userSet = setMock.mock.calls.map((c: any[]) => c[0]).find((s: any) => s.status === 'erased');
        expect(userSet).toBeDefined();
        expect(userSet.email).not.toBe(mockUser.email);
        expect(userSet.picture).toBeNull();

        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'erasure', triggerSource: 'user', userId: userCtx.userId }),
        );
        expect(mockAvatarStore.deleteAllForUser).toHaveBeenCalledWith(userCtx.userId);
        expect(mockSqs.enqueueDeletion).toHaveBeenCalledWith(
            expect.objectContaining({ identityId: 'user_abc123', userId: userCtx.userId, event: 'erasure' }),
        );
    });

    // ⛔ THE ENQUEUE IS THE WHOLE ERASURE, NOT A NOTIFICATION. Identity has scrubbed its own row by this
    // point, so the DB says "erased" — but the Clerk account still exists, and recipe and food still hold
    // the user's data. Every one of those is destroyed by the worker this message wakes. A swallowed
    // failure here is therefore a user who was told their data was erased while their account still signs
    // in and two services still hold their content, with nothing recorded anywhere. Page, exactly as
    // closure does for its ban.
    it('eraseUserMe PAGES when the erasure event cannot be enqueued', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        mockDb.update = vi.fn().mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockSqs.enqueueDeletion.mockRejectedValueOnce(new Error('AccessDenied'));

        await expect(usersService.eraseUserMe(userCtx)).resolves.toMatchObject({ sub: userCtx.userId });

        expect(reportDeletionEnqueueFailure).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'erasure', userId: userCtx.userId, identityId: 'user_abc123' }),
        );
    });

    it('eraseUserMe is idempotent for an already-erased user and writes NO second audit row', async () => {
        // R9: the audit log is append-only, so a repeat call (a retry, a double-tap, the fan-out re-driving)
        // must not manufacture a second erasure event for one erasure.
        mockDb.select = vi.fn().mockReturnValue(makeChain([{ ...mockUser, status: 'erased' }]));
        const insertValues = vi.fn().mockResolvedValue(undefined);
        mockDb.insert = vi.fn().mockReturnValue({ values: insertValues });
        const setMock = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
        mockDb.update = vi.fn().mockReturnValue({ set: setMock });

        await expect(usersService.eraseUserMe(userCtx)).resolves.toMatchObject({ sub: userCtx.userId });

        expect(insertValues).not.toHaveBeenCalled();
        expect(setMock).not.toHaveBeenCalled();
    });

    it('eraseUserMe still enqueues when the avatar delete fails, and does not report success quietly', async () => {
        // S3 is not transactional and the row is already scrubbed, so a failed object delete cannot roll the
        // erasure back — but it leaves a real orphaned image of a user who asked to be erased, so it is an
        // ERROR, not the `warn` closure uses for its recoverable tombstone.
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        mockDb.update = vi.fn().mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockAvatarStore.deleteAllForUser.mockRejectedValue(new Error('s3 down'));

        await expect(usersService.eraseUserMe(userCtx)).resolves.toMatchObject({ sub: userCtx.userId });
        expect(mockSqs.enqueueDeletion).toHaveBeenCalledWith(expect.objectContaining({ event: 'erasure' }));
    });

    it('eraseUserMe throws when the user is missing', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([]));

        await expect(usersService.eraseUserMe(userCtx)).rejects.toThrow('User not found');
    });
});

describe('AdminService', () => {
    let adminService: any;
    let mockDb: any;

    beforeEach(async () => {
        vi.resetModules();

        mockDb = {
            select: vi.fn().mockReturnValue(makeChain([mockUser])),
            update: vi.fn().mockReturnValue({
                set: () => ({ where: () => Promise.resolve() }),
            }),
        };

        const { AdminService } = await import('../src/admin/admin.service.js');

        adminService = new AdminService(mockDb, { enqueueDeletion: vi.fn() } as never);
    });

    it('suspendUser updates db status to suspended', async () => {
        const result = await adminService.suspendUser('01HZZZZZZZZZZZZZZZZZZZZZZU', adminCtx);

        expect(result.status).toBe('suspended');
    });

    it('unsuspendUser updates db status to active', async () => {
        const result = await adminService.unsuspendUser('01HZZZZZZZZZZZZZZZZZZZZZZU', adminCtx);

        expect(result.status).toBe('active');
    });

    it('startImpersonation returns session metadata', async () => {
        const result = await adminService.startImpersonation('01HZZZZZZZZZZZZZZZZZZZZZZU', adminCtx);

        expect(result.impersonatorSub).toBe('01HZZZZZZZZZZZZZZZZZZZZZZA');
        expect(result.impersonatedSub).toBe('01HZZZZZZZZZZZZZZZZZZZZZZU');
        expect(result.sessionId).toContain('imp-');
    });

    it('stopImpersonation returns stop metadata', async () => {
        const result = await adminService.stopImpersonation('01HZZZZZZZZZZZZZZZZZZZZZZU', adminCtx);

        expect(result.impersonatorSub).toBe('01HZZZZZZZZZZZZZZZZZZZZZZA');
        expect(result.impersonatedSub).toBe('01HZZZZZZZZZZZZZZZZZZZZZZU');
    });

    it('suspendUser throws when target missing', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([]));

        await expect(adminService.suspendUser('missing', adminCtx)).rejects.toThrow();
    });

    it('rejects non-admin user enumeration', async () => {
        await expect(adminService.listUsers(userCtx, {})).rejects.toThrow();
    });
});
