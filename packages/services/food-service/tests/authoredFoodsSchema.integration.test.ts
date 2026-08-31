/**
 * U10 — the authored-foods substrate against the REAL migrated database (migration 0013).
 *
 * ⛔ WHY THIS TIER IS MANDATORY (the plan's own scenario list): the dedup split is TWO PARTIAL UNIQUE
 * indexes whose WHERE clauses a unit test cannot observe, the visibility rule is a CHECK constraint, and
 * the authored-macros write depends on `food_nutrients.source_id` having become NULLABLE — all claims
 * about the database, provable only against it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { DATABASE_URL, makePool, resetSchema } from './support/db.js';

const AUTHOR_A = '01JAUTHOREDFOODSAAAAAAAAAA';
const AUTHOR_B = '01JAUTHOREDFOODSBBBBBBBBBB';

describe.skipIf(!DATABASE_URL)('authored foods schema (integration, U10)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = makePool();
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    async function insertFood(id: string, normalizedName: string, userId: string | null, visibility: string) {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status, user_id, visibility)
             VALUES ($1, $2, $2, 'RESOLVED', $3, $4)`,
            [id, normalizedName, userId, visibility],
        );
    }

    it('two authors may own the same name; the same author may not (per-author partial unique)', async () => {
        await insertFood('f-a1', 'my protein blend', AUTHOR_A, 'private');
        await insertFood('f-b1', 'my protein blend', AUTHOR_B, 'private');

        await expect(insertFood('f-a2', 'my protein blend', AUTHOR_A, 'private')).rejects.toThrow(
            /food_normalized_name_per_author_unique/,
        );
    });

    it('an authored name may SHADOW a catalog name — the catalog uniqueness no longer reaches owned rows', async () => {
        await insertFood('f-cat', 'butter', null, 'public');
        await insertFood('f-a1', 'butter', AUTHOR_A, 'private');

        // …and the catalog itself stays unique among unowned rows.
        await expect(insertFood('f-cat2', 'butter', null, 'public')).rejects.toThrow(
            /food_normalized_name_catalog_unique/,
        );
    });

    it('⛔ the visibility CHECK makes illegal states unrepresentable', async () => {
        // A catalog row cannot be private, and an authored row cannot claim the catalog's public.
        await expect(insertFood('f-x1', 'x1', null, 'private')).rejects.toThrow(/food_visibility_coherent/);
        await expect(insertFood('f-x2', 'x2', AUTHOR_A, 'public')).rejects.toThrow(/food_visibility_coherent/);
        // The two legal authored states both insert.
        await insertFood('f-x3', 'x3', AUTHOR_A, 'private');
        await insertFood('f-x4', 'x4', AUTHOR_B, 'promoted');
    });

    it('an authored macro row needs NO food_sources crosswalk (source_id nullable, KTD-H)', async () => {
        await insertFood('f-a1', 'my blend', AUTHOR_A, 'private');
        await pool.query(
            `INSERT INTO nutrient (id, name, unit, external_code) VALUES ('n-kcal', 'Energy', 'kcal', '208')
             ON CONFLICT DO NOTHING`,
        );

        await pool.query(
            `INSERT INTO food_nutrients (id, food_id, nutrient_id, amount, basis, source_id)
             VALUES ('fn-1', 'f-a1', 'n-kcal', 250, 'per_100g', NULL)`,
        );

        const rows = await pool.query(`SELECT amount FROM food_nutrients WHERE food_id = 'f-a1'`);

        expect(rows.rows).toHaveLength(1);
    });
});
