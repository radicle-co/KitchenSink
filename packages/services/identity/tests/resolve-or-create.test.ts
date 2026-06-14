import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

function selectChain<T>(result: T) {
    return {
        from: () => ({
            where: () => ({
                limit: () => Promise.resolve(result),
            }),
        }),
    };
}

const insertNoop = {
    values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
};

function insertUsersReturning<T>(rows: T) {
    return {
        values: () => ({
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve(rows) }),
        }),
    };
}

describe('UsersService.resolveOrCreateFromClaims', () => {
    let usersService: any;
    let mockDb: any;

    beforeEach(async () => {
        vi.resetModules();
        mockDb = { select: vi.fn(), insert: vi.fn() };

        const { UsersService } = await import('../src/users/users.service.js');

        usersService = new UsersService(mockDb, {} as never, {} as never);
    });

    it('returns context for an existing user that already has an account (no writes)', async () => {
        const userRow = { id: '01EXISTINGUSER000000000000', email: 'a@b.com' };
        const account = { id: 'acc-1', userId: '01EXISTINGUSER000000000000' };

        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(selectChain([userRow])) // find user by identityId
            .mockReturnValueOnce(selectChain([account])); // find account

        const ctx = await usersService.resolveOrCreateFromClaims({
            sub: 'user_x',
            email: 'a@b.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
        });

        expect(ctx).toEqual({
            userId: '01EXISTINGUSER000000000000',
            email: 'a@b.com',
            clerkUserId: 'user_x',
            scopes: [],
            permissions: [],
            tokenType: 'user',
        });
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('creates user + account + profile for a never-seen identity', async () => {
        const createdAt = new Date(1_000);
        const createdRow = { id: '01NEWUSER0000000000000000', email: 'n@b.com', createdAt, updatedAt: createdAt };

        mockDb.select = vi.fn().mockReturnValueOnce(selectChain([])); // not found → create

        mockDb.insert = vi
            .fn()
            .mockReturnValueOnce(insertUsersReturning([createdRow])) // user upsert (returns the row)
            .mockReturnValueOnce(insertNoop) // account
            .mockReturnValueOnce(insertNoop); // profile

        const ctx = await usersService.resolveOrCreateFromClaims({ sub: 'user_new', email: 'n@b.com' });

        expect(ctx.userId).toBe('01NEWUSER0000000000000000');
        expect(ctx.clerkUserId).toBe('user_new');
        expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it('heals a webhook-first user that is missing an account (account + profile only)', async () => {
        const userRow = { id: '01LEGACYUSER00000000000000', email: 'l@b.com' };

        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(selectChain([userRow])) // found user
            .mockReturnValueOnce(selectChain([])); // no account

        mockDb.insert = vi
            .fn()
            .mockReturnValueOnce(insertNoop) // account
            .mockReturnValueOnce(insertNoop); // profile

        const ctx = await usersService.resolveOrCreateFromClaims({ sub: 'user_legacy', firstName: 'Leg' });

        expect(ctx.userId).toBe('01LEGACYUSER00000000000000');
        expect(mockDb.insert).toHaveBeenCalledTimes(2); // no user upsert — user already existed
    });

    it('creates with a per-identity placeholder email when the token carries no email claim', async () => {
        const createdAt = new Date(2_000);
        const createdRow = {
            id: '01NOEMAIL000000000000000A',
            email: 'user_noemail@no-email.invalid',
            createdAt,
            updatedAt: createdAt,
        };

        // Capture the values passed to the user insert so we can assert the placeholder email.
        const valuesSpy = vi.fn(() => ({
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve([createdRow]) }),
        }));

        mockDb.select = vi.fn().mockReturnValueOnce(selectChain([])); // not found → create

        mockDb.insert = vi
            .fn()
            .mockReturnValueOnce({ values: valuesSpy })
            .mockReturnValueOnce(insertNoop)
            .mockReturnValueOnce(insertNoop);

        const ctx = await usersService.resolveOrCreateFromClaims({ sub: 'user_noemail' });

        expect(ctx.userId).toBe('01NOEMAIL000000000000000A');
        // No NOT NULL UNIQUE violation: a deterministic, per-sub placeholder is inserted.
        expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ email: 'user_noemail@no-email.invalid' }));
    });

    it('passes scopes/permissions from the verified token into the authorizer context', async () => {
        const userRow = { id: '01ADMINUSER000000000000000', email: 'admin@b.com' };
        const account = { id: 'acc-admin', userId: '01ADMINUSER000000000000000' };

        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(selectChain([userRow])) // find user
            .mockReturnValueOnce(selectChain([account])); // find account

        const ctx = await usersService.resolveOrCreateFromClaims({
            sub: 'user_admin',
            email: 'admin@b.com',
            scopes: ['admin:users'],
            permissions: ['admin:users'],
        });

        expect(ctx.scopes).toEqual(['admin:users']);
        expect(ctx.permissions).toEqual(['admin:users']);
    });
});
