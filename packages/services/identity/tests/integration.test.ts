import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noopHandleSyncPublisher } from '../src/users/handle-sync.publisher.js';

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
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
