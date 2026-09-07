/**
 * U3 — the band-authority substrate, asserted against a real Docker PostgreSQL (migration 0036).
 *
 * Three tables and one column, each with a claim only the database can prove:
 *
 *  - `resolution_band_authority` — one row per band, PK over the FULL band key including
 *    `ranker_version` (R15: a version bump re-earns, so two versions of one shape are DIFFERENT rows).
 *  - `resolution_band_observations` — the measured record; the CHECK refuses a verdict outside
 *    agree/disagree (a could-not-judge is absence, never an observation).
 *  - `resolution_band_skips` — a band-authorized skip stores the READY verification message (jsonb) and
 *    the epoch it skipped under, which is what makes revocation's re-verification enumerable (R14)
 *    without rebuilding messages outside the producer.
 *  - `ingredient_resolutions.query_shape` — the band key's third axis, recorded at resolve time.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const BAND = ['head', '0.15-0.20', 'single-token', 'v1-test'] as const;

describe.skipIf(!hasDatabaseUrl)('resolution band tables (migration 0036)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM resolution_band_skips WHERE ranker_version = 'v1-test'`);
        await pool.query(`DELETE FROM resolution_band_observations WHERE ranker_version = 'v1-test'`);
        await pool.query(`DELETE FROM resolution_band_authority WHERE ranker_version = 'v1-test'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('authority is keyed on the FULL band including ranker_version — a version bump is a new row', async () => {
        await pool.query(
            `INSERT INTO resolution_band_authority (rung, margin_band, query_shape, ranker_version, state, epoch)
             VALUES ($1, $2, $3, $4, 'observing', 0)`,
            [...BAND],
        );
        await pool.query(
            `INSERT INTO resolution_band_authority (rung, margin_band, query_shape, ranker_version, state, epoch)
             VALUES ($1, $2, $3, 'v2-test', 'observing', 0)`,
            [...BAND.slice(0, 3)],
        );
        await pool.query(`DELETE FROM resolution_band_authority WHERE ranker_version = 'v2-test'`);

        await expect(
            pool.query(
                `INSERT INTO resolution_band_authority (rung, margin_band, query_shape, ranker_version, state, epoch)
                 VALUES ($1, $2, $3, $4, 'observing', 0)`,
                [...BAND],
            ),
        ).rejects.toThrow(/duplicate key/i);
    });

    it('⛔ an observation verdict outside agree/disagree is refused at the WRITE', async () => {
        await expect(
            pool.query(
                `INSERT INTO resolution_band_observations (rung, margin_band, query_shape, ranker_version, verdict)
                 VALUES ($1, $2, $3, $4, 'abstain')`,
                [...BAND],
            ),
        ).rejects.toThrow(/check constraint/i);
    });

    it('a skip stores the ready message and its epoch, and drain marks it without deleting it', async () => {
        const message = { verificationKey: 'k1', foodId: 'f1', evidenceKind: 'ranked' };
        await pool.query(
            `INSERT INTO resolution_band_skips (rung, margin_band, query_shape, ranker_version, epoch, message)
             VALUES ($1, $2, $3, $4, 3, $5::jsonb)`,
            [...BAND, JSON.stringify(message)],
        );

        await pool.query(`UPDATE resolution_band_skips SET drained_at = now() WHERE ranker_version = 'v1-test'`);
        const { rows } = await pool.query(
            `SELECT message, epoch, drained_at FROM resolution_band_skips WHERE ranker_version = 'v1-test'`,
        );

        expect(rows[0].message).toEqual(message);
        expect(rows[0].epoch).toBe(3);
        expect(rows[0].drained_at).not.toBeNull();
    });

    it('ingredient_resolutions gained query_shape (the band key third axis)', async () => {
        const { rows } = await pool.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name = 'ingredient_resolutions' AND column_name = 'query_shape'`,
        );

        expect(rows).toHaveLength(1);
    });
});
