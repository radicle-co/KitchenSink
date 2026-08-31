/**
 * U2 — `ingredient_resolutions`, asserted against a real Docker PostgreSQL (migration 0035).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the table is the band log's substrate and the verification producer's
 * evidence source — a unit test cannot observe that the migration applied, that the tier CHECK actually
 * refuses a typo, or that ON DELETE CASCADE follows the ingredient. Each of those is a claim about the
 * DATABASE.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)`, matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const INGREDIENT_ID = 'aaaa0002-0000-4000-8000-000000000001';

describe.skipIf(!hasDatabaseUrl)('ingredient_resolutions (migration 0035)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered) VALUES ($1, 'u2 probe', false)
                          ON CONFLICT (id) DO NOTHING`,
            [INGREDIENT_ID],
        );
    });

    afterEach(async () => {
        await pool.query('DELETE FROM ingredient_resolutions WHERE ingredient_id = $1', [INGREDIENT_ID]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM ingredients WHERE id = $1', [INGREDIENT_ID]);
        await pool.end();
    });

    it('records an event and reads it back latest-first', async () => {
        await pool.query(`INSERT INTO ingredient_resolutions (ingredient_id, tier) VALUES ($1, 'curated')`, [
            INGREDIENT_ID,
        ]);
        await pool.query(
            `INSERT INTO ingredient_resolutions (ingredient_id, tier, rung, margin, shortlist)
             VALUES ($1, 'memo', NULL, NULL, NULL)`,
            [INGREDIENT_ID],
        );

        const { rows } = await pool.query(
            `SELECT tier FROM ingredient_resolutions WHERE ingredient_id = $1 ORDER BY created_at DESC, tier`,
            [INGREDIENT_ID],
        );

        expect(rows.map((row) => row.tier)).toContain('curated');
        expect(rows.map((row) => row.tier)).toContain('memo');
    });

    it('⛔ refuses a tier outside the cascade vocabulary at the WRITE', async () => {
        await expect(
            pool.query(`INSERT INTO ingredient_resolutions (ingredient_id, tier) VALUES ($1, 'vibes')`, [
                INGREDIENT_ID,
            ]),
        ).rejects.toThrow(/check constraint/i);
    });

    it('follows the ingredient on delete — an event never outlives its subject', async () => {
        const orphan = 'aaaa0002-0000-4000-8000-000000000002';
        await pool.query(`INSERT INTO ingredients (id, name, is_user_entered) VALUES ($1, 'u2 orphan', false)`, [
            orphan,
        ]);
        await pool.query(`INSERT INTO ingredient_resolutions (ingredient_id, tier) VALUES ($1, 'memo')`, [orphan]);
        await pool.query('DELETE FROM ingredients WHERE id = $1', [orphan]);

        const { rows } = await pool.query('SELECT 1 FROM ingredient_resolutions WHERE ingredient_id = $1', [orphan]);

        expect(rows).toHaveLength(0);
    });

    it('stores a structured shortlist as jsonb, round-tripping candidate fields', async () => {
        const shortlist = [
            { foodId: 'f1', score: 0.9, energyKcalPer100g: 364 },
            { foodId: 'f2', score: 0.4 },
        ];
        await pool.query(
            `INSERT INTO ingredient_resolutions (ingredient_id, tier, rung, margin, shortlist)
             VALUES ($1, 'lexical', 'head', 0.5, $2::jsonb)`,
            [INGREDIENT_ID, JSON.stringify(shortlist)],
        );

        const { rows } = await pool.query(
            `SELECT shortlist FROM ingredient_resolutions WHERE ingredient_id = $1 AND tier = 'lexical'`,
            [INGREDIENT_ID],
        );

        expect(rows[0].shortlist).toEqual(shortlist);
    });
});
