/**
 * Migration `0056_author_handle_tombstone` — the erasure tombstone on `author_handles` — asserted against a real
 * PostgreSQL.
 *
 * ⛔ WHY THIS TIER. A unit test cannot observe a migration that did not apply. The decision (a late handle-sync
 * snapshot must not re-identify an erased author) rests on two database properties: `erased_at` exists and is
 * nullable, and a CHECK makes a tombstone that still carries a username UNREPRESENTABLE — so no writer, whatever its
 * bug, can leave the real handle beside the marker that says it was erased.
 *
 * Runs as `recipe_app`, the role the service holds; the rows it writes are removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const USER_ID = '01TOMBSTONE0000000000000AA';

describe('migration 0056 — author_handles tombstone', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 2 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM author_handles WHERE user_id = $1', [USER_ID]);
        await pool.end();
    });

    it('author_handles.erased_at is a nullable timestamptz with NO default', async () => {
        const { rows } = await pool.query<{ type: string; not_null: boolean; has_default: boolean }>(
            `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
               FROM pg_attribute a
              WHERE a.attrelid = 'public.author_handles'::regclass AND a.attname = 'erased_at' AND NOT a.attisdropped`,
        );

        expect(rows).toEqual([{ type: 'timestamp with time zone', not_null: false, has_default: false }]);
    });

    it('⛔ rejects a tombstone that still carries a username', async () => {
        await expect(
            pool.query(
                `INSERT INTO author_handles (user_id, display_name, username, source_timestamp, erased_at)
                 VALUES ($1, 'user_x', 'realname', now(), now())`,
                [USER_ID],
            ),
        ).rejects.toMatchObject({ constraint: 'author_handles_tombstone_has_no_username' });
    });

    it('accepts a tombstone with no username, and a live row with a username and no tombstone', async () => {
        await pool.query(
            `INSERT INTO author_handles (user_id, display_name, username, source_timestamp, erased_at)
             VALUES ($1, 'user_x', NULL, now(), now())`,
            [USER_ID],
        );
        await pool.query('DELETE FROM author_handles WHERE user_id = $1', [USER_ID]);
        await pool.query(
            `INSERT INTO author_handles (user_id, display_name, username, source_timestamp)
             VALUES ($1, 'Real Name', 'realname', now())`,
            [USER_ID],
        );

        const { rows } = await pool.query<{ erased_at: Date | null }>(
            'SELECT erased_at FROM author_handles WHERE user_id = $1',
            [USER_ID],
        );

        expect(rows).toEqual([{ erased_at: null }]);
    });
});
