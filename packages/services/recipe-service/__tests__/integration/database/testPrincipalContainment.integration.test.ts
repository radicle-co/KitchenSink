/**
 * Migrations 0044 + 0045 — the test-principal registry and the test-reset job table (ADR-0040), asserted against
 * a real PostgreSQL, as the SERVICE role (`recipe_app`, ADR-0039).
 *
 * ⛔ WHY THIS TIER: a unit test cannot observe a migration that did not apply, a privilege the service role does
 * not hold, or a partial unique index that does not match the `ON CONFLICT` target the DAL issues. Each of those
 * is the difference between "a second reset request returns the job already running" and "two purges race".
 *
 * Load-bearing rows:
 *  - `test_principals` is keyed on `user_id` and an upsert of the same id is a no-op (the middleware re-registers
 *    on every process start).
 *  - `test_reset_jobs` admits at most ONE active (`queued`/`running`) job per user, and a `completed` job does NOT
 *    block the next one — the reset is repeatable, unlike erasure's one-shot `410`.
 *  - the status CHECK refuses a value outside the four the worker writes.
 *  - the service role can read and write both tables.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { hasTestDatabase, recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();

const TEST_USER = '01JZTESTPRINCIPALREGISTRY1';
const OTHER_USER = '01JZTESTPRINCIPALREGISTRY2';

describe.skipIf(!hasTestDatabase)('test_principals + test_reset_jobs (migrations 0044, 0045)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM test_reset_jobs WHERE user_id IN ($1, $2)`, [TEST_USER, OTHER_USER]);
        await pool.query(`DELETE FROM test_principals WHERE user_id IN ($1, $2)`, [TEST_USER, OTHER_USER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('creates test_principals with exactly the registry columns', async () => {
        const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
            `SELECT column_name, is_nullable FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'test_principals' ORDER BY column_name`,
        );

        expect(rows).toEqual([
            { column_name: 'registered_at', is_nullable: 'NO' },
            { column_name: 'user_id', is_nullable: 'NO' },
        ]);
    });

    it('registers a principal idempotently — a second upsert of the same id is a no-op', async () => {
        await pool.query(`INSERT INTO test_principals (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [
            TEST_USER,
        ]);
        await pool.query(`INSERT INTO test_principals (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [
            TEST_USER,
        ]);

        const { rows } = await pool.query(`SELECT user_id FROM test_principals WHERE user_id = $1`, [TEST_USER]);

        expect(rows).toHaveLength(1);
    });

    it('creates test_reset_jobs with the columns the worker and the route read', async () => {
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'test_reset_jobs' ORDER BY column_name`,
        );

        expect(rows.map((row) => row.column_name)).toEqual([
            'attempts',
            'created_at',
            'id',
            'last_error',
            'status',
            'updated_at',
            'user_id',
        ]);
    });

    it('⛔ admits at most ONE active reset job per user, through the partial index the DAL targets', async () => {
        const insert = (userId: string) =>
            pool.query<{ id: string }>(
                `INSERT INTO test_reset_jobs (user_id) VALUES ($1)
                 ON CONFLICT (user_id) WHERE status IN ('queued', 'running') DO NOTHING
                 RETURNING id`,
                [userId],
            );

        const first = await insert(TEST_USER);
        const second = await insert(TEST_USER);
        const otherUser = await insert(OTHER_USER);

        expect(first.rows).toHaveLength(1);
        // The loser of the race gets zero rows — a fact, not an error.
        expect(second.rows).toHaveLength(0);
        expect(otherUser.rows).toHaveLength(1);
    });

    it('⛔ a COMPLETED reset does not block the next one — the purge is repeatable, never a one-shot 410', async () => {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO test_reset_jobs (user_id) VALUES ($1) RETURNING id`,
            [TEST_USER],
        );
        await pool.query(`UPDATE test_reset_jobs SET status = 'completed' WHERE id = $1`, [rows[0]?.id]);

        const next = await pool.query<{ id: string }>(
            `INSERT INTO test_reset_jobs (user_id) VALUES ($1)
             ON CONFLICT (user_id) WHERE status IN ('queued', 'running') DO NOTHING
             RETURNING id`,
            [TEST_USER],
        );

        expect(next.rows).toHaveLength(1);
    });

    it('refuses a status outside the four the worker writes', async () => {
        await expect(
            pool.query(`INSERT INTO test_reset_jobs (user_id, status) VALUES ($1, 'erased')`, [TEST_USER]),
        ).rejects.toThrow(/check constraint/i);
    });
});
