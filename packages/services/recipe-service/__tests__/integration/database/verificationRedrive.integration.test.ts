/**
 * U4c — the pending re-drive substrate's WRITE half against a real PostgreSQL (migration 0037).
 *
 * The upsert's two claims are both about the database: that `DO UPDATE` replaces the message under the
 * same key, and that `created_at` survives the conflict — the age bound must measure from the FIRST
 * withholding, or every re-save would reset the clock and a stranded line would never age into re-drive.
 */
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle } from '../../../src/database/client.js';
import { VerificationRedriveDal } from '../../../src/ingredients/resolution/verificationRedrive.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const KEY = 'v2:redrivedal-test-0001';

describe.skipIf(!hasDatabaseUrl)('VerificationRedriveDal (migration 0037)', () => {
    let pool: pg.Pool;
    let dal: VerificationRedriveDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        dal = new VerificationRedriveDal(createRecipeDrizzle(pool));
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_ingredient_verification_redrive WHERE verification_key = $1', [KEY]);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('records a message and, on re-save, replaces the MESSAGE while keeping the original created_at', async () => {
        await dal.record(KEY, { sourceLine: 'first rendering' });
        await pool.query(
            `UPDATE recipe_ingredient_verification_redrive SET created_at = now() - interval '10 hours'
              WHERE verification_key = $1`,
            [KEY],
        );

        await dal.record(KEY, { sourceLine: 'newer rendering' });

        const { rows } = await pool.query<{ message: { sourceLine: string }; aged: boolean }>(
            `SELECT message, created_at < now() - interval '9 hours' AS aged
               FROM recipe_ingredient_verification_redrive WHERE verification_key = $1`,
            [KEY],
        );

        expect(rows[0]?.message).toEqual({ sourceLine: 'newer rendering' });
        // ⛔ The age is the FIRST withholding's — a reset here would let re-saves postpone the re-drive
        // forever.
        expect(rows[0]?.aged).toBe(true);
    });
});
