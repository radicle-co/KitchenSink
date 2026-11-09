/**
 * Migration 0064 against the REAL migrated database: a published, public recipe holds no line bound to a private food
 * (ADR-0029 §4). The rule is written in SQL once (`recipe_private_food_lines`, `recipe_holds_private_food`) and
 * enforced by constraint triggers on both tables a violation can come from, so a write path the service forgets is a
 * rolled-back transaction rather than a leak.
 *
 * Claims only the database can prove: each raw-SQL door raises, the helper functions answer with positions, a draft /
 * private / deleted recipe is exempt, and the `FOR SHARE` lock closes the race between adding a private line and
 * making the recipe public, in BOTH orders, the triggers judge the state a transaction LEAVES (they are deferred to
 * commit), and a line on a catalog food takes no recipe lock, so a settle and a save cannot deadlock.
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

    describe('the triggers are DEFERRED to commit: they judge the state a transaction leaves', () => {
        it('a save that publishes AND swaps its private line for a catalog one in one transaction commits', async () => {
            const id = await recipe('public', 'draft');
            const client = await pool.connect();

            await line(id, privateLookup, 0);

            try {
                await client.query('BEGIN');
                // The order a save writes in: the recipe row first, the lines after.
                await client.query(`UPDATE recipes SET status = 'published' WHERE id = $1`, [id]);
                await client.query(`DELETE FROM ingredients WHERE recipe_id = $1`, [id]);
                await line(id, catalogLookup, 0, client);
                await client.query('COMMIT');
            } finally {
                await client.query('ROLLBACK').catch(() => undefined);
                client.release();
            }

            expect((await pool.query(`SELECT status FROM recipes WHERE id = $1`, [id])).rows[0]).toEqual({
                status: 'published',
            });
        });

        it('still refuses at COMMIT when the transaction leaves a private line on a published public recipe', async () => {
            const id = await recipe('public', 'draft');
            const client = await pool.connect();

            await line(id, privateLookup, 0);

            try {
                await client.query('BEGIN');
                await client.query(`UPDATE recipes SET status = 'published' WHERE id = $1`, [id]);
                await expect(client.query('COMMIT')).rejects.toMatchObject(violation);
            } finally {
                await client.query('ROLLBACK').catch(() => undefined);
                client.release();
            }

            expect((await pool.query(`SELECT status FROM recipes WHERE id = $1`, [id])).rows[0]).toEqual({
                status: 'draft',
            });
        });

        it('a private line added and removed inside one transaction judges nothing', async () => {
            const id = await recipe('public', 'published');
            const client = await pool.connect();

            try {
                await client.query('BEGIN');
                await line(id, privateLookup, 0, client);
                await client.query(`DELETE FROM ingredients WHERE recipe_id = $1`, [id]);
                await client.query('COMMIT');
            } finally {
                await client.query('ROLLBACK').catch(() => undefined);
                client.release();
            }
        });
    });

    describe('the FOR SHARE lock, taken only for a private line, closes the race with going public', () => {
        const pending = (promise: Promise<unknown>): Promise<'pending' | 'settled'> =>
            Promise.race([
                promise.then(
                    () => 'settled' as const,
                    () => 'settled' as const,
                ),
                new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 400)),
            ]);

        it('going public commits first: the private line, committing after it, raises', async () => {
            const id = await recipe('private', 'published');
            const adder = await pool.connect();

            try {
                await adder.query('BEGIN');
                await line(id, privateLookup, 0, adder);
                // The adder's line is uncommitted and its check is deferred, so the publish is not held up by it.
                const publishing = pool.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [id]);

                expect(await pending(publishing)).toBe('settled');
                await expect(adder.query('COMMIT')).rejects.toMatchObject(violation);
                await publishing.catch(() => undefined);
            } finally {
                await adder.query('ROLLBACK').catch(() => undefined);
                adder.release();
            }

            expect((await pool.query(`SELECT 1 FROM ingredients WHERE recipe_id = $1`, [id])).rows).toHaveLength(0);
        });

        it('a publish still uncommitted holds the recipe, so a private line waits at commit and then raises', async () => {
            const id = await recipe('private', 'published');
            const adder = await pool.connect();
            const publisher = await pool.connect();

            try {
                await publisher.query('BEGIN');
                await publisher.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [id]);
                await adder.query('BEGIN');

                // Deferred: the line goes in at once, and the check — with its lock — waits for COMMIT.
                const adding = line(id, privateLookup, 0, adder);

                expect(await pending(adding)).toBe('settled');

                const committing = adder.query('COMMIT');

                expect(await pending(committing)).toBe('pending');
                await publisher.query('COMMIT');
                await expect(committing).rejects.toMatchObject(violation);
            } finally {
                // The publisher first: the adder's queued statements may be waiting on its lock.
                await publisher.query('ROLLBACK').catch(() => undefined);
                await adder.query('ROLLBACK').catch(() => undefined);
                adder.release();
                publisher.release();
            }
        });

        it('a line on a CATALOG food takes no lock on the recipe, so it never waits behind a recipe update', async () => {
            const id = await recipe('private', 'published');
            const adder = await pool.connect();
            const updater = await pool.connect();

            try {
                await updater.query('BEGIN');
                await updater.query(`UPDATE recipes SET title = title || '!' WHERE id = $1`, [id]);
                await adder.query('BEGIN');

                const adding = line(id, catalogLookup, 0, adder);

                expect(await pending(adding)).toBe('settled');

                const committing = adder.query('COMMIT');

                expect(await pending(committing)).toBe('settled');
                await committing;
            } finally {
                await updater.query('ROLLBACK').catch(() => undefined);
                await adder.query('ROLLBACK').catch(() => undefined);
                adder.release();
                updater.release();
            }
        });
    });

    describe('a settle and a recipe save do not deadlock (40P01)', () => {
        it('settle holds the failure and moves the save’s line while the save holds the recipe and waits for the failure', async () => {
            const id = await recipe('public', 'published');
            const failure = (
                await pool.query<{ id: string }>(
                    `INSERT INTO unresolved_foods (name, source_phrase, normalized_key, reason_code, tiers_consulted, tiers_unavailable, detail)
                     VALUES ($1, $1, $1, 'cascade_exhausted', '{}', '{}', NULL) RETURNING id`,
                    [`${SCOPE}-failure`],
                )
            ).rows[0]!.id;
            const failureLookup = (
                await pool.query<{ id: string }>(
                    `INSERT INTO food_lookups (unresolved_food_id) VALUES ($1) RETURNING id`,
                    [failure],
                )
            ).rows[0]!.id;
            const save = await pool.connect();
            const settle = await pool.connect();

            await line(id, failureLookup, 0);

            try {
                // The save: holds the recipe row (its UPDATE), then reads the failure FOR SHARE (replaceForRecipe).
                await save.query('BEGIN');
                await save.query(`UPDATE recipes SET title = title || '!' WHERE id = $1`, [id]);

                // The settle: locks the failure, then moves every line on it, this recipe's included.
                await settle.query('BEGIN');
                await settle.query(`SELECT 1 FROM unresolved_foods WHERE id = $1 FOR UPDATE`, [failure]);

                const moving = settle.query(`UPDATE ingredients SET food_lookup_id = $1 WHERE food_lookup_id = $2`, [
                    catalogLookup,
                    failureLookup,
                ]);
                const reading = save.query(`SELECT 1 FROM unresolved_foods WHERE id = $1 FOR SHARE`, [failure]);

                await expect(Promise.all([moving.then(() => settle.query('COMMIT')), reading])).resolves.toBeDefined();
                await save.query('COMMIT');
            } finally {
                await save.query('ROLLBACK').catch(() => undefined);
                await settle.query('ROLLBACK').catch(() => undefined);
                save.release();
                settle.release();
                await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [OWNER]);
                await pool.query(`DELETE FROM food_lookups WHERE id = $1`, [failureLookup]);
                await pool.query(`DELETE FROM unresolved_foods WHERE id = $1`, [failure]);
            }
        });
    });
});
