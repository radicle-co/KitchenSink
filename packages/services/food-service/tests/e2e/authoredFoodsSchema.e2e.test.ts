/**
 * U10 — the authored-foods substrate against the REAL migrated database (migration 0013).
 *
 * ⛔ WHY THIS TIER IS MANDATORY (the plan's own scenario list): the dedup split is TWO PARTIAL UNIQUE
 * indexes whose WHERE clauses a unit test cannot observe, the visibility rule is a CHECK constraint, and
 * the authored-macros write depends on an UNCITED value being admitted under an authored food (0018) — all claims
 * about the database, provable only against it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { makePool } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

const AUTHOR_A = '01JAUTHOREDFOODSAAAAAAAAAA';
const AUTHOR_B = '01JAUTHOREDFOODSBBBBBBBBBB';

describe('authored foods schema (integration, U10)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = makePool();
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    async function insertFood(
        id: string,
        normalizedName: string,
        userId: string | null,
        visibility: 'public' | 'private' | 'promoted',
    ) {
        await makeCatalogFood(pool, { id, name: normalizedName, normalizedName, userId, visibility });
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

    it('an authored macro value needs NO citation and NO food_sources crosswalk (KTD-H, KTD-19)', async () => {
        await insertFood('f-a1', 'my blend', AUTHOR_A, 'private');
        await pool.query(
            `INSERT INTO nutrient (id, name, unit, infoods_tag) VALUES ('n-kcal', 'Energy', 'kcal', 'ENERC_KCAL')
             ON CONFLICT DO NOTHING`,
        );
        await pool.query(`INSERT INTO food_nutrition (id, food_id) VALUES ('fh-1', 'f-a1')`);

        await pool.query(
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
             VALUES ('fh-1', 'n-kcal', 250, 'per_100g', NULL)`,
        );

        const rows = await pool.query(`SELECT amount FROM food_nutrient_view WHERE food_id = 'f-a1'`);

        expect(rows.rows).toHaveLength(1);
    });
});
