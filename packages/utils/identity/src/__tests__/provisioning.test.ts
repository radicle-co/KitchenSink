import { describe, expect, it, vi } from 'vitest';

import { provisionCompleteUser, type ProvisionDeps, type ProvisioningSchema } from '../provisioning.js';

// Sentinel table objects — the mock db keys behavior off `__t`; `.name`/`.picture`/`.identityId` stand
// in for Drizzle columns referenced by the `sql\`coalesce(...)\`` / conflict target (never executed).
const usersT = {
    __t: 'users',
    identityId: { name: 'identity_id' },
    name: { name: 'name' },
    picture: { name: 'picture' },
};
const accountsT = { __t: 'accounts' };
const profilesT = { __t: 'profiles' };
const schema = { users: usersT, accounts: accountsT, profiles: profilesT } as unknown as ProvisioningSchema;

const emailViolation = Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'users_email_unique',
});

interface MockOpts {
    userInsertThrowsOnce?: unknown;
}

function buildMockDb(opts: MockOpts = {}) {
    const insertedTables: string[] = [];
    const valuesByTable = new Map<string, Record<string, unknown>>();
    const conflictSets: Array<Record<string, unknown>> = [];
    let userReturningCount = 0;
    const row = { id: 'usr_test', identityId: 'id_1', email: 'a@b.com', deletedAt: null };

    const db = {
        insert(table: { __t: string }) {
            insertedTables.push(table.__t);

            return {
                values(v: Record<string, unknown>) {
                    valuesByTable.set(table.__t, v);

                    return {
                        onConflictDoUpdate(arg: { set: Record<string, unknown> }) {
                            conflictSets.push(arg.set);

                            return {
                                returning() {
                                    userReturningCount += 1;

                                    if (opts.userInsertThrowsOnce && userReturningCount === 1) {
                                        return Promise.reject(opts.userInsertThrowsOnce);
                                    }

                                    return Promise.resolve([row]);
                                },
                            };
                        },
                        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
                    };
                },
            };
        },
    };

    const deps: ProvisionDeps = {
        db: db as unknown as ProvisionDeps['db'],
        schema,
        newUserId: () => 'usr_test',
    };

    return { deps, insertedTables, valuesByTable, conflictSets };
}

describe('provisionCompleteUser', () => {
    it('upserts the user, then the account, then the profile (one complete unit)', async () => {
        const { deps, insertedTables, valuesByTable } = buildMockDb();

        const result = await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com', name: 'Ada', avatarUrl: 'https://img/ada.png' },
            { onEmailCollision: 'placeholder' },
        );

        expect(result.kind).toBe('complete');
        expect(insertedTables).toEqual(['users', 'accounts', 'profiles']);
        expect(valuesByTable.get('accounts')).toEqual({ userId: 'usr_test' });
        expect(valuesByTable.get('profiles')).toEqual({
            userId: 'usr_test',
            displayName: 'Ada',
            avatarUrl: 'https://img/ada.png',
        });
    });

    it('resets deletedAt on conflict (revives a re-registered soft-deleted identity)', async () => {
        const { deps, conflictSets } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(conflictSets[0]).toHaveProperty('deletedAt', null);
    });

    it('overwrites email on conflict only when emailIsReal (default true)', async () => {
        const { deps, conflictSets } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'real@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(conflictSets[0]).toHaveProperty('email', 'real@b.com');
    });

    it('email collision + placeholder policy: retries with a placeholder email, does not overwrite real email', async () => {
        const { deps, insertedTables, valuesByTable, conflictSets } = buildMockDb({
            userInsertThrowsOnce: emailViolation,
        });

        const result = await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'taken@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(result.kind).toBe('complete');
        // First user insert (threw), retry user insert, then aux.
        expect(insertedTables).toEqual(['users', 'users', 'accounts', 'profiles']);
        expect(valuesByTable.get('users')).toMatchObject({ email: 'id_1@no-email.invalid' });
        // The retry runs with emailIsReal:false, so its conflict set carries NO email key.
        expect(conflictSets[1]).not.toHaveProperty('email');
    });

    it('email collision + signal-incomplete policy: returns incomplete, creates no aux rows', async () => {
        const { deps, insertedTables } = buildMockDb({ userInsertThrowsOnce: emailViolation });

        const result = await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'taken@b.com' },
            { onEmailCollision: 'signal-incomplete' },
        );

        expect(result).toEqual({ kind: 'incomplete', reason: 'email-collision' });
        expect(insertedTables).toEqual(['users']);
    });

    it('rethrows a non-collision error', async () => {
        const dbErr = Object.assign(new Error('connection reset'), { code: '08006' });
        const { deps } = buildMockDb({ userInsertThrowsOnce: dbErr });

        await expect(
            provisionCompleteUser(deps, { identityId: 'id_1', email: 'a@b.com' }, { onEmailCollision: 'placeholder' }),
        ).rejects.toThrow('connection reset');
    });

    it('defaults displayName to name (then empty) and accepts a null avatar', async () => {
        const { deps, valuesByTable } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(valuesByTable.get('profiles')).toEqual({ userId: 'usr_test', displayName: '', avatarUrl: null });
    });
});
