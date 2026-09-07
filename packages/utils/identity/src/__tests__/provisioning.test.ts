import { describe, expect, it, vi } from 'vitest';

import { provisionCompleteUser, type ProvisionDeps, type ProvisioningSchema } from '../provisioning.js';

// Sentinel table objects — the mock db keys behavior off `__t`; the `.name`/`.picture`/`.identityId`/`.status`/
// `.deletedAt`/`.email` stand in for Drizzle columns referenced by the `sql\`case ...\`` conflict set (the SQL
// is never executed here — the mock captures the `set` shape; the CASE semantics are proven in integration).
const usersT = {
    __t: 'users',
    identityId: { name: 'identity_id' },
    name: { name: 'name' },
    picture: { name: 'picture' },
    status: { name: 'status' },
    deletedAt: { name: 'deleted_at' },
    email: { name: 'email' },
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
    /** The `status` of the row the (conflict) upsert returns — drives the R10 no-resurrection guard. */
    rowStatus?: string;
}

function buildMockDb(opts: MockOpts = {}) {
    const insertedTables: string[] = [];
    const valuesByTable = new Map<string, Record<string, unknown>>();
    const conflictSets: Array<Record<string, unknown>> = [];
    /**
     * Every statement the routine runs on a TRANSACTION handle, in order, plus which table each `insert`
     * targeted — so a test can assert that the advisory lock is taken BEFORE the users upsert and that the aux
     * inserts are NOT inside the transaction. Recorded rather than ignored on purpose: a double that silently
     * accepted `execute()` would let the lock be deleted with the unit suite still green.
     */
    const txStatements: string[] = [];
    let userReturningCount = 0;
    const row = {
        id: 'usr_test',
        identityId: 'id_1',
        email: 'a@b.com',
        deletedAt: null,
        status: opts.rowStatus ?? 'active',
    };

    const db = {
        /**
         * Runs the callback with a handle that records `execute`d statements and delegates `insert` to the same
         * recorder the autocommit path uses, so a table inserted inside the transaction is distinguishable
         * from one inserted outside it by position in `txStatements`.
         */
        transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
            const tx = {
                execute(statement: { queryChunks?: unknown[] }) {
                    // Drizzle's `sql` template object: flatten whatever string parts it carries so the
                    // assertion can look for the function name without depending on the driver's dialect.
                    txStatements.push(`execute:${JSON.stringify(statement?.queryChunks ?? statement)}`);

                    return Promise.resolve([]);
                },
                insert(table: { __t: string }) {
                    txStatements.push(`insert:${table.__t}`);

                    return db.insert(table);
                },
            };

            return fn(tx);
        },
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

    return { deps, insertedTables, valuesByTable, conflictSets, txStatements };
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

    /**
     * The per-identity serialization, at unit speed.
     *
     * `provisioningRace.integration.test.ts` proves the runtime behaviour against a real Postgres (provisioning
     * blocks behind the lock). These two assert the STRUCTURE that produces it, so the guard runs on every
     * `npm test` without a database:
     *
     *  1. the advisory lock is the FIRST statement in the transaction, before the upsert — a lock taken after
     *     the insert would serialize nothing, because the deadlock forms *inside* the insert's speculative
     *     insertion (heap tuple + one index tuple per unique index, `identity_id` AND `users_email_unique`);
     *  2. the aux inserts stay OUTSIDE the transaction — putting them in is the `d59e11c` deadlock, from the
     *     opposite direction, so the fix for one must not become the other.
     */
    it('takes the per-identity advisory lock BEFORE the users upsert, inside one transaction', async () => {
        const { deps, txStatements } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(txStatements[0], 'no statement ran on the transaction handle — the upsert is not serialized').toMatch(
            /pg_advisory_xact_lock/,
        );
        expect(txStatements[1]).toBe('insert:users');
    });

    it('keeps the accounts/profiles inserts OUT of that transaction (the d59e11c deadlock)', async () => {
        const { deps, txStatements, insertedTables } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(insertedTables).toEqual(['users', 'accounts', 'profiles']);
        expect(txStatements).not.toContain('insert:accounts');
        expect(txStatements).not.toContain('insert:profiles');
    });

    it('carries a lifecycle-aware deletedAt directive in the conflict set (revival gated on status)', async () => {
        // R10: `deletedAt` is no longer an unconditional literal null — it is a `case`-expression that only
        // clears deletedAt for a NON-tombstoned/erased row. The unit mock captures the key's presence; the
        // integration suite proves the CASE preserves a tombstoned row's deletedAt.
        const { deps, conflictSets } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(conflictSets[0]).toHaveProperty('deletedAt');
    });

    it('includes email in the conflict set only when emailIsReal (default true)', async () => {
        const { deps, conflictSets } = buildMockDb();

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'real@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(conflictSets[0]).toHaveProperty('email');
    });

    it('R10: does NOT rebuild account/profile when the upserted row is tombstoned (no resurrection)', async () => {
        const { deps, insertedTables } = buildMockDb({ rowStatus: 'tombstoned' });

        const result = await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com', name: 'Ada', picture: 'https://img/ada.png' },
            { onEmailCollision: 'placeholder' },
        );

        // Only the users upsert ran — the closed account's companion rows are NEVER re-created.
        expect(insertedTables).toEqual(['users']);
        expect(result.kind).toBe('complete');
    });

    it('R10: does NOT rebuild account/profile when the upserted row is erased (no resurrection)', async () => {
        const { deps, insertedTables } = buildMockDb({ rowStatus: 'erased' });

        await provisionCompleteUser(
            deps,
            { identityId: 'id_1', email: 'a@b.com' },
            { onEmailCollision: 'placeholder' },
        );

        expect(insertedTables).toEqual(['users']);
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
