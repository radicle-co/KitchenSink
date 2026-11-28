/**
 * Migration 0099 — the database accepts a held public row, and the read rule hides it (ADR-0105), asserted against a real
 * PostgreSQL as the SERVICE role (ADR-0039).
 *
 * `recipes_held_is_not_public` is dropped: the read function `recipe_held_from_readers` (0098) is the one place that says a held
 * recipe is not readable, so the database no longer refuses `visibility = 'public'` on a held row. What is asserted:
 *
 *  1. The constraint is gone from the catalog.
 *  2. An UPDATE to public on a held row, an INSERT of a public held row and holding a public row all succeed, and the read
 *     function answers true for each (the hide), where a clean public control answers false.
 *  3. A public clone of a held recipe inherits the hold through the trigger (0092, unchanged) and is held from readers.
 *  4. The hold ratchet is unchanged: true to false is still refused.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { PRIVATE_ONLY_SOURCE_KEYS } from '@kitchensink/recipe-core';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU9HELDNEVERREAD0000OWNR';
const CHECK_VIOLATION = '23514';
const KEYS = JSON.stringify(PRIVATE_ONLY_SOURCE_KEYS);

describe('a held recipe may be public; the read rule hides it (migration 0099)', () => {
    let pool: pg.Pool;
    const created: string[] = [];

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        // Clones first: no foreign key meets a half-deleted tree.
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[]) AND cloned_from_id IS NOT NULL`, [created]);
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [created]);
        created.length = 0;
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertRecipe(over: {
        visibility?: 'private' | 'public';
        hold?: boolean;
        clonedFromId?: string;
    }): Promise<string> {
        const id = randomUUID();

        created.push(id);
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, source_type, cloned_from_id,
                                  source_correction_hold)
             VALUES ($1, $2, 'Held never readable', '', 1, 1, 2, 4, $3, 'draft', 'user_created', $4, $5)`,
            [id, OWNER_ID, over.visibility ?? 'private', over.clonedFromId ?? null, over.hold ?? false],
        );

        return id;
    }

    async function held(id: string): Promise<boolean | null> {
        const { rows } = await pool.query<{ held: boolean | null }>(
            `SELECT recipe_held_from_readers(r, $2::jsonb) AS held FROM recipes r WHERE r.id = $1`,
            [id, KEYS],
        );

        return rows[0]?.held ?? null;
    }

    async function holdOf(id: string): Promise<boolean | undefined> {
        const { rows } = await pool.query<{ hold: boolean }>(
            `SELECT source_correction_hold AS hold FROM recipes WHERE id = $1`,
            [id],
        );

        return rows[0]?.hold;
    }

    it('has no recipes_held_is_not_public constraint', async () => {
        const { rows } = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = 'recipes_held_is_not_public'`);

        expect(rows).toHaveLength(0);
    });

    it('accepts an UPDATE to public on a held row, and the read function hides it; a clean public row is not hidden', async () => {
        const id = await insertRecipe({ hold: true });
        const clean = await insertRecipe({});

        await pool.query(`UPDATE recipes SET visibility = 'public' WHERE id = ANY($1::uuid[])`, [[id, clean]]);

        expect((await pool.query(`SELECT visibility FROM recipes WHERE id = $1`, [id])).rows[0]).toEqual({
            visibility: 'public',
        });
        expect(await held(id)).toBe(true);
        expect(await held(clean)).toBe(false);
    });

    it('accepts an INSERT of a public held row, and holding a row that is already public', async () => {
        const inserted = await insertRecipe({ visibility: 'public', hold: true });
        const later = await insertRecipe({ visibility: 'public' });

        await pool.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [later]);

        expect(await held(inserted)).toBe(true);
        expect(await held(later)).toBe(true);
    });

    it('a public clone of a held recipe inherits the hold by trigger and is held from readers', async () => {
        const parent = await insertRecipe({ hold: true });
        const clone = await insertRecipe({ visibility: 'public', clonedFromId: parent, hold: false });

        expect(await holdOf(clone)).toBe(true);
        expect(await held(clone)).toBe(true);
    });

    it('still refuses clearing the hold (true to false) by any writer', async () => {
        const id = await insertRecipe({ hold: true, visibility: 'public' });

        await expect(
            pool.query(`UPDATE recipes SET source_correction_hold = false WHERE id = $1`, [id]),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
});
