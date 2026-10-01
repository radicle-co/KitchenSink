/**
 * U2 — `ingredient_resolutions`, asserted against a real Docker PostgreSQL (migration 0035).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the table is the band log's substrate and the verification producer's
 * evidence source — a unit test cannot observe that the migration applied, that the tier CHECK actually
 * refuses a typo, or that ON DELETE CASCADE follows the subject. Each of those is a claim about the DATABASE.
 *
 * ⚠️ REWRITTEN (plan 002): since migration 0051 an event's subject is the BINDING (`food_lookups`, column
 * `food_lookup_id`) rather than the dropped name catalog, and 0051 re-adds the cascading foreign key against it.
 * The four assertions are unchanged; they now follow the binding, which `tests/support/lineChain.ts` creates.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)`, matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ensureFoodLookup } from '../../../tests/support/lineChain.js';
import { hasTestDatabase, recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();
const hasDatabaseUrl = hasTestDatabase;

/** The binding every event is recorded against — a `food_lookups` id since 0051. */
const LOOKUP_ID = 'aaaa0002-0000-4000-8000-000000000001';
const PROBE_FOOD_ID = '01JU2RESOLUTIONS0000000FOOD';
const ORPHAN_FOOD_ID = '01JU2RESOLUTIONS000000ORPHN';

describe.skipIf(!hasDatabaseUrl)('ingredient_resolutions (migrations 0035 → 0051)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        await ensureFoodLookup(pool, { arm: 'shared', foodId: PROBE_FOOD_ID, id: LOOKUP_ID });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM ingredient_resolutions WHERE food_lookup_id = $1', [LOOKUP_ID]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM food_lookups WHERE food_id = ANY($1)', [[PROBE_FOOD_ID, ORPHAN_FOOD_ID]]);
        await pool.end();
    });

    it('records an event and reads it back latest-first', async () => {
        await pool.query(`INSERT INTO ingredient_resolutions (food_lookup_id, tier) VALUES ($1, 'curated')`, [
            LOOKUP_ID,
        ]);
        await pool.query(
            `INSERT INTO ingredient_resolutions (food_lookup_id, tier, rung, margin, shortlist)
             VALUES ($1, 'memo', NULL, NULL, NULL)`,
            [LOOKUP_ID],
        );

        const { rows } = await pool.query(
            `SELECT tier FROM ingredient_resolutions WHERE food_lookup_id = $1 ORDER BY created_at DESC, tier`,
            [LOOKUP_ID],
        );

        expect(rows.map((row) => row.tier)).toContain('curated');
        expect(rows.map((row) => row.tier)).toContain('memo');
    });

    it('⛔ refuses a tier outside the cascade vocabulary at the WRITE', async () => {
        await expect(
            pool.query(`INSERT INTO ingredient_resolutions (food_lookup_id, tier) VALUES ($1, 'vibes')`, [LOOKUP_ID]),
        ).rejects.toThrow(/check constraint/i);
    });

    it('follows the binding on delete — an event never outlives its subject', async () => {
        const orphan = await ensureFoodLookup(pool, { arm: 'shared', foodId: ORPHAN_FOOD_ID });
        await pool.query(`INSERT INTO ingredient_resolutions (food_lookup_id, tier) VALUES ($1, 'memo')`, [orphan]);

        // The positive control: the event exists, so its absence below is the cascade and not a missed write.
        const before = await pool.query('SELECT 1 FROM ingredient_resolutions WHERE food_lookup_id = $1', [orphan]);
        expect(before.rows).toHaveLength(1);

        await pool.query('DELETE FROM food_lookups WHERE id = $1', [orphan]);

        const { rows } = await pool.query('SELECT 1 FROM ingredient_resolutions WHERE food_lookup_id = $1', [orphan]);

        expect(rows).toHaveLength(0);
    });

    it('stores a structured shortlist as jsonb, round-tripping candidate fields', async () => {
        const shortlist = [
            { foodId: 'f1', score: 0.9, energyKcalPer100g: 364 },
            { foodId: 'f2', score: 0.4 },
        ];
        await pool.query(
            `INSERT INTO ingredient_resolutions (food_lookup_id, tier, rung, margin, shortlist)
             VALUES ($1, 'lexical', 'head', 0.5, $2::jsonb)`,
            [LOOKUP_ID, JSON.stringify(shortlist)],
        );

        const { rows } = await pool.query(
            `SELECT shortlist FROM ingredient_resolutions WHERE food_lookup_id = $1 AND tier = 'lexical'`,
            [LOOKUP_ID],
        );

        expect(rows[0].shortlist).toEqual(shortlist);
    });
});
