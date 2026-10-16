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
    roles: [] as const,
    testPrincipal: false,
};

const userCtx = {
    userId: '01HZZZZZZZZZZZZZZZZZZZZZZB' as const,
    clerkUserId: 'user_abc123',
    email: 'test@example.com',
    tokenType: 'user' as const,
    scopes: [],
    permissions: [],
    roles: [] as const,
    testPrincipal: false,
};

const mockUser = {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZB',
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
        mockAvatarStore = { removeAll: vi.fn().mockResolvedValue(undefined) };
        mockResolver = {
            resolveUser: vi.fn().mockResolvedValue({
                user: mockUser,
                account: {
                    id: 'a-1',
                    userId: '01HZZZZZZZZZZZZZZZZZZZZZZB',
                    subscriptionTier: 'free',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            }),
        };

        const { UsersService } = await import('../src/users/users.service.js');

        usersService = new UsersService(mockDb, mockSqs, mockResolver, noopHandleSyncPublisher, mockAvatarStore, false);
    });

    it('getUserMe returns aggregated profile', async () => {
        const profile = {
            id: 'p-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZB',
            displayName: 'Test',
            avatarUrl: null,
            bio: null,
            updatedAt: new Date(),
        };
        const account = {
            id: 'a-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZB',
            subscriptionTier: 'free',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        mockResolver.resolveUser.mockResolvedValue({ user: mockUser, account });
        mockDb.select = vi.fn().mockReturnValueOnce(makeChain([profile]));

        const result = await usersService.getUserMe(userCtx);

        expect(result.user.id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZB');
        // No role and the gate off (the suite's service is built with `false`): no paid feature, no upsell.
        expect(result.account.paidFeatures).toBe('hidden');
        expect(result.account).not.toHaveProperty('subscriptionTier');
    });

    it('getUserMe answers granted for an entitled role, from the verified roles', async () => {
        mockDb.select = vi.fn().mockReturnValueOnce(makeChain([]));

        const result = await usersService.getUserMe({ ...userCtx, roles: ['vip'] });

        expect(result.account.paidFeatures).toBe('granted');
    });

    /** The old grant was a `premium` PERMISSION. Roles replaced it: the permission alone grants nothing now. */
    it('getUserMe ignores a bare premium permission', async () => {
        mockDb.select = vi.fn().mockReturnValueOnce(makeChain([]));

        const result = await usersService.getUserMe({ ...userCtx, permissions: ['premium'] });

        expect(result.account.paidFeatures).toBe('hidden');
    });

    it('getUserMe throws when user missing', async () => {
        mockResolver.resolveUser.mockRejectedValue(new Error('User not found'));

        await expect(usersService.getUserMe(userCtx)).rejects.toThrow();
    });

    it('upsertUser creates user via clerkId and returns ULID id', async () => {
        const newUser = { ...mockUser, id: '01HZZZZZZZZZZZZZZZZZZZZZZB' };
        const inserted: Record<string, unknown>[] = [];

        mockDb.insert = vi.fn().mockReturnValue({
            values: (values: Record<string, unknown>) => {
                inserted.push(values);

                return {
                    onConflictDoUpdate: () => ({
                        returning: () => Promise.resolve([newUser]),
                    }),
                    onConflictDoNothing: () =>
                        Object.assign(Promise.resolve(), { returning: () => Promise.resolve([]) }),
                };
            },
        });

        const result = await usersService.upsertUser(userCtx, {
            clerkId: 'user_abc123',
            email: 'test@example.com',
            name: 'Test User',
        });

        expect(result.id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZB');
        // createdAt === updatedAt on the returned row signals a first-time insert (see UsersService.upsertUser).
        expect(result.created).toBe(true);
        // ⛔ It publishes no byline, so the profile it creates must owe none: a debt nothing settles is a sync the
        // identity backstop reports as LOST on every run (plan 2026-10-15-010).
        const profile = inserted.find((values) => 'displayName' in values);
        expect(profile).toMatchObject({ handleSyncOwedAt: null });
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

        // BOTH avatar columns are cleared on the kept profile row: the Clerk URL and the uploaded key (ADR-0064).
        const profileSet = setMock.mock.calls.map((c: any[]) => c[0]).find((v: any) => 'avatarKey' in v);
        expect(profileSet).toMatchObject({ avatarUrl: null, avatarKey: null });

        // R8 audit row written for the closure transition (trigger = user self-service).
        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'closure', triggerSource: 'user', userId: userCtx.userId }),
        );

        // The avatar S3 object is deleted, and the Clerk BAN is handed to the deletion-worker as a closure event.
        expect(mockAvatarStore.removeAll).toHaveBeenCalledWith(userCtx.userId);
        expect(mockSqs.enqueueDeletion).toHaveBeenCalledWith(
            expect.objectContaining({ identityId: 'user_abc123', userId: userCtx.userId, event: 'closure' }),
        );
    });

    it('deleteUserMe closure still succeeds when the avatar S3 delete fails (best-effort)', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        mockDb.update = vi.fn().mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockAvatarStore.removeAll.mockRejectedValue(new Error('s3 down'));

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
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZB',
            displayName: 'New Name',
            avatarUrl: null,
            username: 'newname',
            updatedAt: new Date(),
        };
        const updatedAccount = {
            id: 'a-1',
            userId: '01HZZZZZZZZZZZZZZZZZZZZZZB',
            subscriptionTier: 'free',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(makeChain([mockUser]))
            .mockReturnValueOnce(makeChain([updatedAccount]));

        // The profile comes back from the UPDATE's own RETURNING (plan 2026-10-15-010 D6); the later settle of the
        // handle-sync debt is a plain UPDATE … WHERE.
        mockDb.update = vi.fn().mockReturnValue({
            set: () => ({
                where: () => Object.assign(Promise.resolve(), { returning: () => Promise.resolve([updatedProfile]) }),
            }),
        });

        const result = await usersService.patchUserMe({ ...userCtx, roles: ['premium'] }, { displayName: 'New Name' });

        expect(result.user.displayName).toBe('New Name');
        // A display-name edit leaves the Clerk-owned username as it was, and answers it.
        expect(result.user.username).toBe('newname');
        // The PATCH response builds its account half separately; it must answer the same field.
        expect(result.account.paidFeatures).toBe('granted');
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
        // Identity holds no Clerk secret, so it cannot have deleted the provider account: it records the
        // deletion as still owed (explicit null, never absent) and the worker confirms it later.
        expect(userSet).toHaveProperty('providerDeletedAt', null);

        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'erasure', triggerSource: 'user', userId: userCtx.userId }),
        );
        expect(mockAvatarStore.removeAll).toHaveBeenCalledWith(userCtx.userId);
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

    // ⛔ REWRITTEN (ADR-0064). This test used to assert that erasure ENQUEUED even when the avatar delete failed. That
    // left an erased user's photograph in the bucket AND in the CDN edge cache, with the erasure reported as done and
    // nothing left to retry it. A failed removal or invalidation is now fatal to the request, BEFORE the row is erased
    // and before anything is enqueued, so the caller retries the whole erasure - the same non-terminal shape the recipe
    // erasure worker has for a failed CDN invalidation.
    it('eraseUserMe is NON-TERMINAL when the avatar removal or invalidation fails: nothing erased, nothing enqueued', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        const setMock = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
        mockDb.update = vi.fn().mockReturnValue({ set: setMock });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockAvatarStore.removeAll.mockRejectedValue(new Error('cloudfront down'));

        await expect(usersService.eraseUserMe(userCtx)).rejects.toThrow('cloudfront down');

        expect(setMock).not.toHaveBeenCalled();
        expect(mockDb.transaction).not.toHaveBeenCalled();
        expect(mockSqs.enqueueDeletion).not.toHaveBeenCalled();
    });

    it('eraseUserMe removes the avatar objects BEFORE it erases the row', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([mockUser]));
        mockDb.update = vi.fn().mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
        mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        const order: string[] = [];
        mockAvatarStore.removeAll.mockImplementation(() => {
            order.push('remove');

            return Promise.resolve();
        });
        mockDb.transaction = vi.fn((cb: (tx: any) => unknown) => {
            order.push('erase');

            return cb(mockDb);
        });

        await usersService.eraseUserMe(userCtx);

        expect(order[0]).toBe('remove');
        expect(order).toContain('erase');
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
        const result = await adminService.suspendUser('01HZZZZZZZZZZZZZZZZZZZZZZB', adminCtx);

        expect(result.status).toBe('suspended');
    });

    it('unsuspendUser updates db status to active', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([{ ...mockUser, status: 'suspended' }]));
        const result = await adminService.unsuspendUser('01HZZZZZZZZZZZZZZZZZZZZZZB', adminCtx);

        expect(result.status).toBe('active');
    });

    it('suspendUser throws when target missing', async () => {
        mockDb.select = vi.fn().mockReturnValue(makeChain([]));

        await expect(adminService.suspendUser('missing', adminCtx)).rejects.toThrow();
    });

    it('rejects non-admin user enumeration', async () => {
        await expect(adminService.listUsers(userCtx, {})).rejects.toThrow();
    });
});
