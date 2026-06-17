import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

// The combined completeness pre-check: select({...}).from().leftJoin().leftJoin().where().limit().
// Result rows are `{ user, accountId, profileId }` (accountId/profileId null ⇒ that aux row is missing).
function selectChain<T>(result: T) {
    const leaf = { where: () => ({ limit: () => Promise.resolve(result) }) };

    return {
        from: () => ({
            leftJoin: () => ({ leftJoin: () => leaf }),
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

    it('returns context for a complete existing user (no writes)', async () => {
        const userRow = { id: '01EXISTINGUSER000000000000', email: 'a@b.com' };

        // Single combined query — user present, both aux rows present ⇒ complete.
        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(selectChain([{ user: userRow, accountId: 'acc-1', profileId: 'prof-1' }]));

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

    it('heals an existing user missing its profile (the old check looked only at accounts)', async () => {
        const userRow = {
            id: '01LEGACYUSER00000000000000',
            email: 'l@b.com',
            createdAt: new Date(1),
            updatedAt: new Date(1),
        };

        // User present + account present but profile MISSING — the old accounts-only check would skip this.
        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(selectChain([{ user: userRow, accountId: 'acc-x', profileId: null }]));

        mockDb.insert = vi
            .fn()
            .mockReturnValueOnce(insertUsersReturning([userRow])) // routine re-upserts the user (idempotent)
            .mockReturnValueOnce(insertNoop) // account
            .mockReturnValueOnce(insertNoop); // profile

        const ctx = await usersService.resolveOrCreateFromClaims({ sub: 'user_legacy', firstName: 'Leg' });

        expect(ctx.userId).toBe('01LEGACYUSER00000000000000');
        expect(mockDb.insert).toHaveBeenCalledTimes(3); // healed through the shared routine
    });

    it('creates with a per-identity placeholder email when the token carries no email claim', async () => {
        const createdAt = new Date(2_000);
        const createdRow = {
            id: '01NOEMAIL000000000000000A',
            email: 'user_noemail@no-email.invalid',
            createdAt,
            updatedAt: createdAt,
        };

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
        expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ email: 'user_noemail@no-email.invalid' }));
    });

    it('provisions with a placeholder when the real email collides with another identity (23505)', async () => {
        const createdAt = new Date(3_000);
        const placeholderRow = {
            id: '01COLLIDE0000000000000000',
            email: 'user_collide@no-email.invalid',
            createdAt,
            updatedAt: createdAt,
        };
        // Drizzle wraps the pg error (code/constraint) in `.cause` — the routine walks the chain.
        const uniqueViolation = Object.assign(new Error('Failed query: insert into "users"'), {
            cause: Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
                code: '23505',
                constraint: 'users_email_unique',
            }),
        });

        mockDb.select = vi.fn().mockReturnValueOnce(selectChain([])); // not found → create

        const placeholderValuesSpy = vi.fn(() => ({
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve([placeholderRow]) }),
        }));

        mockDb.insert = vi
            .fn()
            // 1st upsert with the real email → email-unique violation (email owned by another identity)
            .mockReturnValueOnce({
                values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.reject(uniqueViolation) }) }),
            })
            // retry: user upsert with the placeholder, then account + profile
            .mockReturnValueOnce({ values: placeholderValuesSpy })
            .mockReturnValueOnce(insertNoop)
            .mockReturnValueOnce(insertNoop);

        const ctx = await usersService.resolveOrCreateFromClaims({ sub: 'user_collide', email: 'taken@b.com' });

        expect(ctx.userId).toBe('01COLLIDE0000000000000000');
        expect(ctx.email).toBe('user_collide@no-email.invalid');
        expect(placeholderValuesSpy).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'user_collide@no-email.invalid' }),
        );
    });

    it('rethrows a non-email-collision insert error (does not swallow unrelated failures)', async () => {
        const otherError = Object.assign(new Error('boom'), { code: '40001' }); // serialization failure

        mockDb.select = vi.fn().mockReturnValueOnce(selectChain([]));
        mockDb.insert = vi.fn().mockReturnValueOnce({
            values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.reject(otherError) }) }),
        });

        await expect(usersService.resolveOrCreateFromClaims({ sub: 'user_err', email: 'x@b.com' })).rejects.toThrow(
            'boom',
        );
    });

    it('passes scopes/permissions from the verified token into the authorizer context', async () => {
        const userRow = { id: '01ADMINUSER000000000000000', email: 'admin@b.com' };

        mockDb.select = vi
            .fn()
            .mockReturnValueOnce(selectChain([{ user: userRow, accountId: 'acc-admin', profileId: 'prof-admin' }]));

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
