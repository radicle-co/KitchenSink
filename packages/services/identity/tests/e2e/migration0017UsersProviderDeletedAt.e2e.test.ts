/**
 * Migration `0017_users_provider_deleted_at`, against a real database.
 *
 * ⛔ WHY THIS TIER. The claim is a property of Postgres: two CHECK constraints make "the identity provider still
 * holds a live account for a person we report as reconciled-erased" UNSTORABLE. A mocked database accepts every
 * row it is handed, so only a real one can show the constraints reject.
 *
 *  - `provider_deleted_at` is set only on an `erased` row (a live account has nothing to confirm deleted).
 *  - `reconciled_at` is set only once the provider is confirmed deleted (reconciliation may not call an erasure
 *    complete while the Clerk account is alive).
 *
 * Runs as `identity_service`, the role the deployed service holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { identityDb } from '../support/roleDb.js';

const roleDb = identityDb();

/** The stamps a fixture row may carry. */
interface UserColumns {
    readonly status: string;
    readonly providerDeletedAt?: string | null;
    readonly reconciledAt?: string | null;
}

/**
 * Insert one `users` row with the given status and stamps.
 *
 * @param pool - A pool connected as the service role.
 * @param id - The row's id (also seeds the unique identity id and email).
 * @param columns - Status and stamps.
 * @sideEffect Writes `users`.
 */
async function insertUser(pool: pg.Pool, id: string, columns: UserColumns): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, identity_id, email, status, provider_deleted_at, reconciled_at)
         VALUES ($1, $2, $3, $4::user_status, $5, $6)`,
        [
            id,
            `user_${id}`,
            `${id}@example.com`,
            columns.status,
            columns.providerDeletedAt ?? null,
            columns.reconciledAt ?? null,
        ],
    );
}

describe('0017_users_provider_deleted_at (real Postgres)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    it('adds a nullable timestamptz column with NO default (NULL means "not confirmed")', async () => {
        const { rows } = await pool.query<{ type: string; not_null: boolean; has_default: boolean }>(
            `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
               FROM pg_attribute a
              WHERE a.attrelid = 'public.users'::regclass AND a.attname = 'provider_deleted_at' AND NOT a.attisdropped`,
        );

        expect(rows).toEqual([{ type: 'timestamp with time zone', not_null: false, has_default: false }]);
    });

    it('lets the service role read and write the column without a migration granting it (ADR-0039)', async () => {
        const { rows } = await pool.query<Record<string, boolean>>(
            `SELECT has_column_privilege(current_user, 'public.users', 'provider_deleted_at', 'SELECT') AS "select",
                    has_column_privilege(current_user, 'public.users', 'provider_deleted_at', 'UPDATE') AS "update"`,
        );

        expect(rows).toEqual([{ select: true, update: true }]);
    });

    describe('provider_deleted_at is set only on an erased row', () => {
        it.each(['active', 'suspended', 'tombstoned'])('rejects a %s row carrying the stamp', async (status) => {
            await expect(
                insertUser(pool, `u_${status}`, { status, providerDeletedAt: '2026-10-01T00:00:00Z' }),
            ).rejects.toThrow(/users_provider_deleted_only_erased/);
        });

        it('accepts an erased row with the stamp, and an erased row without it', async () => {
            await insertUser(pool, 'u_a', { status: 'erased', providerDeletedAt: '2026-10-01T00:00:00Z' });
            await insertUser(pool, 'u_b', { status: 'erased' });
            await insertUser(pool, 'u_c', { status: 'active' });

            const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
            expect(rows[0]!.n).toBe('3');
        });
    });

    describe('reconciled_at requires the provider to be confirmed deleted', () => {
        it('rejects a reconciled erased row with no provider confirmation', async () => {
            await expect(
                insertUser(pool, 'u_rec', { status: 'erased', reconciledAt: '2026-10-02T00:00:00Z' }),
            ).rejects.toThrow(/users_reconciled_requires_provider_deleted/);
        });

        it('rejects clearing the confirmation on a reconciled row', async () => {
            await insertUser(pool, 'u_ok', {
                status: 'erased',
                providerDeletedAt: '2026-10-01T00:00:00Z',
                reconciledAt: '2026-10-02T00:00:00Z',
            });

            await expect(pool.query("UPDATE users SET provider_deleted_at = NULL WHERE id = 'u_ok'")).rejects.toThrow(
                /users_reconciled_requires_provider_deleted/,
            );
        });

        it('accepts a reconciled row once the provider is confirmed deleted', async () => {
            await insertUser(pool, 'u_ok2', {
                status: 'erased',
                providerDeletedAt: '2026-10-01T00:00:00Z',
                reconciledAt: '2026-10-02T00:00:00Z',
            });

            const { rows } = await pool.query<{ n: string }>(
                'SELECT count(*) AS n FROM users WHERE reconciled_at IS NOT NULL AND provider_deleted_at IS NOT NULL',
            );
            expect(rows[0]!.n).toBe('1');
        });
    });
});
