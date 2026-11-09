/**
 * Migration 0064 against the REAL migrated database: a published, public recipe holds no line bound to a private food
 * (ADR-0029 §4). The rule is written in SQL once (`recipe_private_food_lines`, `recipe_holds_private_food`) and
 * enforced by constraint triggers on both tables a violation can come from, so a write path the service forgets is a
 * rolled-back transaction rather than a leak.
 *
 * Claims only the database can prove: each raw-SQL door raises, the helper functions answer with positions, a draft /
 * private / deleted recipe is exempt, and the `FOR SHARE` lock closes the race between adding a private line and
 * making the recipe public, in BOTH orders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-public-foods';
const OWNER = '01JPUBFOODSE2E0000000OWNER';
const AUTHOR = '01JPUBFOODSE2E000000AUTHOR';
const PRIVATE_FOOD = `${SCOPE}-private`;
const CATALOG_FOOD = `${SCOPE}-catalog`;

describe('public recipes hold no private food (migration 0064)', () => {
    let pool: pg.Pool;
    let privateLookup: string;
    let catalogLookup: string;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [OWNER]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        privateLookup = (
            await pool.query<{ id: string }>(
                `INSERT INTO food_lookups (food_id, food_owner_id) VALUES ($1, $2) RETURNING id`,
                [PRIVATE_FOOD, AUTHOR],
            )
        ).rows[0]!.id;
        catalogLookup = (
            await pool.query<{ id: string }>(`INSERT INTO food_lookups (food_id) VALUES ($1) RETURNING id`, [
                CATALOG_FOOD,
            ])
        ).rows[0]!.id;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [OWNER]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [OWNER]);
    });

    async function recipe(visibility: 'public' | 'private', status: 'draft' | 'published'): Promise<string> {
        return (
            await pool.query<{ id: string }>(
                `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
                 VALUES ($1, $2, $3, $4, 2, 5, 10, 15) RETURNING id`,
                [OWNER, `${SCOPE} ${visibility} ${status}`, visibility, status],
            )
        ).rows[0]!.id;
    }

    async function line(recipeId: string, lookupId: string, sortOrder: number, client: pg.Pool | pg.PoolClient = pool) {
        return client.query(
            `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order) VALUES ($1, $2, 1, 'g', $3)`,
            [recipeId, lookupId, sortOrder],
        );
    }

    // A check_violation (23514) naming the trigger as its constraint, so the service can tell it from any other.
    const violation = {
        code: '23514',
        constraint: expect.stringMatching(
            /^(ingredients_public_recipe_no_private_food|recipes_public_holds_no_private_food)$/,
        ),
    };

    it('names the private lines with their positions, and answers false for a recipe with none', async () => {
        const id = await recipe('private', 'published');

        await line(id, catalogLookup, 0);
        await line(id, privateLookup, 2);

        const lines = await pool.query(`SELECT sort_order, food_id FROM recipe_private_food_lines($1)`, [id]);
        const holds = await pool.query(`SELECT recipe_holds_private_food($1) AS holds`, [id]);
        const none = await pool.query(`SELECT recipe_holds_private_food($1) AS holds`, [
            await recipe('private', 'draft'),
        ]);

        expect(lines.rows).toEqual([{ sort_order: 2, food_id: PRIVATE_FOOD }]);
        expect(holds.rows[0]).toEqual({ holds: true });
        expect(none.rows[0]).toEqual({ holds: false });
    });

    describe('each raw-SQL door raises for a published public recipe', () => {
        it('INSERT of a line bound to a private food', async () => {
            const id = await recipe('public', 'published');

            await expect(line(id, privateLookup, 0)).rejects.toMatchObject(violation);
            expect((await pool.query(`SELECT 1 FROM ingredients WHERE recipe_id = $1`, [id])).rows).toHaveLength(0);
        });

        it('UPDATE of a line onto a private food', async () => {
            const id = await recipe('public', 'published');

            await line(id, catalogLookup, 0);

            await expect(
                pool.query(`UPDATE ingredients SET food_lookup_id = $1 WHERE recipe_id = $2`, [privateLookup, id]),
            ).rejects.toMatchObject(violation);
        });

        it('UPDATE of visibility to public', async () => {
            const id = await recipe('private', 'published');

            await line(id, privateLookup, 0);

            await expect(
                pool.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [id]),
            ).rejects.toMatchObject(violation);
        });

        it('UPDATE of status to published', async () => {
            const id = await recipe('public', 'draft');

            await line(id, privateLookup, 0);

            await expect(
                pool.query(`UPDATE recipes SET status = 'published' WHERE id = $1`, [id]),
            ).rejects.toMatchObject(violation);
        });

        it('UPDATE that restores a soft-deleted recipe', async () => {
            const id = await recipe('public', 'published');

            await pool.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1`, [id]);
            await line(id, privateLookup, 0);

            await expect(pool.query(`UPDATE recipes SET deleted_at = NULL WHERE id = $1`, [id])).rejects.toMatchObject(
                violation,
            );
        });
    });

    describe('what stays allowed', () => {
        it('a private food in a private published recipe, in a draft, and in a soft-deleted recipe', async () => {
            await line(await recipe('private', 'published'), privateLookup, 0);
            await line(await recipe('public', 'draft'), privateLookup, 0);

            const deleted = await recipe('public', 'published');

            await pool.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1`, [deleted]);
            await line(deleted, privateLookup, 0);
        });

        it('a published public recipe with catalog or promoted foods only', async () => {
            const id = await recipe('public', 'published');

            await line(id, catalogLookup, 0);
            await pool.query(`UPDATE recipes SET title = title || '!' WHERE id = $1`, [id]);
        });
    });

    describe('the FOR SHARE lock closes the race between a private line and going public', () => {
        const pending = (promise: Promise<unknown>): Promise<'pending' | 'settled'> =>
            Promise.race([
                promise.then(
                    () => 'settled' as const,
                    () => 'settled' as const,
                ),
                new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 400)),
            ]);

        it('a line added first holds the recipe, so going public waits and then raises', async () => {
            const id = await recipe('private', 'published');
            const adder = await pool.connect();
            const publisher = await pool.connect();

            try {
                await adder.query('BEGIN');
                await line(id, privateLookup, 0, adder);
                await publisher.query('BEGIN');

                const publishing = publisher.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [id]);
                const outcome = pending(publishing);

                expect(await outcome).toBe('pending');
                await adder.query('COMMIT');
                await expect(publishing).rejects.toMatchObject(violation);
            } finally {
                await publisher.query('ROLLBACK').catch(() => undefined);
                adder.release();
                publisher.release();
            }
        });

        it('going public first holds the recipe, so a private line waits and then raises', async () => {
            const id = await recipe('private', 'published');
            const adder = await pool.connect();
            const publisher = await pool.connect();

            try {
                await publisher.query('BEGIN');
                await publisher.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [id]);
                await adder.query('BEGIN');

                const adding = line(id, privateLookup, 0, adder);

                expect(await pending(adding)).toBe('pending');
                await publisher.query('COMMIT');
                await expect(adding).rejects.toMatchObject(violation);
            } finally {
                await adder.query('ROLLBACK').catch(() => undefined);
                adder.release();
                publisher.release();
            }
        });
    });
});
