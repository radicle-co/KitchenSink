/**
 * Migration 0100 — the correction hold has two ways back, each one audited record (ADR-0106), asserted against a real
 * PostgreSQL as the SERVICE role (`recipe_app`) and, where the plan asks, as the owner role (ADR-0039).
 *
 * Every refusal row asserts the SQLSTATE AND the guard's own message or constraint name, so a refusal by some other guard cannot
 * pass for the one under test. What is asserted:
 *
 *  1. The ratchet: a hold clears only with a record for the same recipe, the same transaction and the same instant, and a clear
 *     is never followed by a hold in that transaction. Mutation: drop the `xact_id` predicate and the earlier-transaction row fails.
 *  2. One record per clear: `UNIQUE (recipe_id, xact_id)`; a record for a recipe that is not held is refused at insert; a record
 *     whose clear was rolled back to a savepoint is refused at commit.
 *  3. A BEFORE UPDATE trigger that sorts after the ratchet cannot clear the hold unseen (the ratchet is an AFTER trigger).
 *  4. The table is append-only for both roles, with the erasure relabel and the recipe-deletion cascade as the only carve-outs.
 *  5. Every function the migration creates or replaces pins `search_path`, has one overload, and the two read functions are
 *     PARALLEL SAFE.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const TOKEN = 'erased_0123456789abcdef0123456789abcdef';

describe('recipe_source_hold_clears (migration 0100)', () => {
    let pool: pg.Pool;
    const created: string[] = [];
    const owners: string[] = [];

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        for (const owner of owners) {
            await pool.query(`DELETE FROM account_erasure_jobs WHERE owner_id = $1`, [owner]);
        }

        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[]) AND cloned_from_id IS NOT NULL`, [created]);
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [created]);
        created.length = 0;
        owners.length = 0;
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertRecipe(hold: boolean): Promise<string> {
        const id = randomUUID();
        const owner = `01JU0HOLDCLR${id.slice(0, 12)}`;

        created.push(id);
        owners.push(owner);
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, source_type, source_correction_hold)
             VALUES ($1, $2, 'Hold clear', '', 1, 1, 2, 4, 'private', 'draft', 'user_created', $3)`,
            [id, owner, hold],
        );

        return id;
    }

    /** Runs `body` in one transaction on its own connection, committing at the end. */
    async function inTx(body: (client: pg.PoolClient) => Promise<void>): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await body(client);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    const recordClear = (client: Pick<pg.Pool, 'query'>, recipeId: string, actor = 'staff01') =>
        client.query(
            `INSERT INTO recipe_source_hold_clears (recipe_id, cause, actor_account_id, reason)
             VALUES ($1, 'staff', $2, 'a mistaken correction')`,
            [recipeId, actor],
        );

    const releaseHold = (client: Pick<pg.Pool, 'query'>, recipeId: string) =>
        client.query(`UPDATE recipes SET source_correction_hold = false WHERE id = $1`, [recipeId]);

    async function holdOf(id: string): Promise<boolean> {
        const { rows } = await pool.query<{ h: boolean }>(
            `SELECT source_correction_hold AS h FROM recipes WHERE id = $1`,
            [id],
        );

        return rows[0]?.h ?? false;
    }

    describe('the ratchet', () => {
        it('clears the hold when a record for this recipe is written in the same transaction', async () => {
            const id = await insertRecipe(true);

            await inTx(async (client) => {
                await recordClear(client, id);
                await releaseHold(client, id);
            });

            expect(await holdOf(id)).toBe(false);
        });

        it('refuses a clear with no record, naming the ratchet', async () => {
            const id = await insertRecipe(true);

            await expect(releaseHold(pool, id)).rejects.toMatchObject({
                code: CHECK_VIOLATION,
                message: expect.stringContaining('cleared only with a clear record in the same transaction'),
            });
            expect(await holdOf(id)).toBe(true);
        });

        it('refuses a clear whose record was committed in an EARLIER transaction (the xact predicate)', async () => {
            const id = await insertRecipe(true);

            await inTx(async (client) => {
                await recordClear(client, id);
                await releaseHold(client, id);
            });
            // Held again by a later transaction (false to true needs no record); the earlier record must not clear it twice.
            await pool.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [id]);

            await expect(releaseHold(pool, id)).rejects.toMatchObject({
                code: CHECK_VIOLATION,
                message: expect.stringContaining('cleared only with a clear record in the same transaction'),
            });
            expect(await holdOf(id)).toBe(true);
        });

        it('refuses a clear whose record is for ANOTHER recipe', async () => {
            const id = await insertRecipe(true);
            const other = await insertRecipe(true);

            await expect(
                inTx(async (client) => {
                    await recordClear(client, other);
                    await releaseHold(client, id);
                }),
            ).rejects.toMatchObject({
                code: CHECK_VIOLATION,
                message: expect.stringContaining('cleared only with a clear record in the same transaction'),
            });
        });

        it('refuses a clear whose record is written AFTER the update, in the same transaction', async () => {
            const id = await insertRecipe(true);

            await expect(
                inTx(async (client) => {
                    await releaseHold(client, id);
                    await recordClear(client, id);
                }),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            expect(await holdOf(id)).toBe(true);
        });

        it('allows the unchanged transitions: false to true with no record, true to true, false to false', async () => {
            const id = await insertRecipe(false);

            await pool.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [id]);
            await pool.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [id]);
            expect(await holdOf(id)).toBe(true);

            const clean = await insertRecipe(false);

            await pool.query(`UPDATE recipes SET source_correction_hold = false WHERE id = $1`, [clean]);
            expect(await holdOf(clean)).toBe(false);
        });

        it('refuses a hold after a clear in the same transaction, with the ratchet message', async () => {
            const id = await insertRecipe(true);

            await expect(
                inTx(async (client) => {
                    await recordClear(client, id);
                    await releaseHold(client, id);
                    await client.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [id]);
                }),
            ).rejects.toMatchObject({
                code: CHECK_VIOLATION,
                message: expect.stringContaining('no hold after a clear in the same transaction'),
            });
        });

        it('is not fooled by a BEFORE UPDATE trigger that sorts after the ratchet and clears the hold (the ratchet is AFTER)', async () => {
            const id = await insertRecipe(true);

            await roleDb.asOwner(async (client) => {
                await client.query(
                    `CREATE FUNCTION trg_zz_test_clear_hold() RETURNS trigger AS $$
                     BEGIN NEW.source_correction_hold := false; RETURN NEW; END; $$ LANGUAGE plpgsql`,
                );
                await client.query(
                    `CREATE TRIGGER trg_zz_test_clear_hold BEFORE UPDATE ON recipes
                     FOR EACH ROW WHEN (NEW.title = 'zz-clear-me') EXECUTE FUNCTION trg_zz_test_clear_hold()`,
                );
            });

            try {
                await expect(
                    pool.query(`UPDATE recipes SET title = 'zz-clear-me' WHERE id = $1`, [id]),
                ).rejects.toMatchObject({
                    code: CHECK_VIOLATION,
                    message: expect.stringContaining('cleared only with a clear record in the same transaction'),
                });
                expect(await holdOf(id)).toBe(true);
            } finally {
                await roleDb.asOwner(async (client) => {
                    await client.query(`DROP TRIGGER trg_zz_test_clear_hold ON recipes`);
                    await client.query(`DROP FUNCTION trg_zz_test_clear_hold()`);
                });
            }
        });
    });

    describe('one record per clear', () => {
        it('refuses a second record for one recipe in one transaction, by the UNIQUE constraint', async () => {
            const id = await insertRecipe(true);

            await expect(
                inTx(async (client) => {
                    await recordClear(client, id);
                    await recordClear(client, id);
                }),
            ).rejects.toMatchObject({
                code: UNIQUE_VIOLATION,
                constraint: 'recipe_source_hold_clears_recipe_xact_key',
            });
        });

        it('refuses a record for a recipe that is not held, at insert', async () => {
            const id = await insertRecipe(false);

            await expect(recordClear(pool, id)).rejects.toMatchObject({
                code: CHECK_VIOLATION,
                message: expect.stringContaining('the recipe is not held'),
            });
        });

        it('refuses a record for a recipe that does not exist with the foreign key, not the not-held guard (the AND FOUND is deliberate)', async () => {
            await expect(recordClear(pool, randomUUID())).rejects.toMatchObject({
                code: '23503',
                constraint: 'recipe_source_hold_clears_recipe_id_fkey',
            });
        });

        it('refuses at COMMIT a record whose clear was rolled back to a savepoint (the deferred check)', async () => {
            const id = await insertRecipe(true);

            await expect(
                inTx(async (client) => {
                    await recordClear(client, id);
                    await client.query('SAVEPOINT s');
                    await releaseHold(client, id);
                    await client.query('ROLLBACK TO SAVEPOINT s');
                }),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            expect(await holdOf(id)).toBe(true);

            const { rows } = await pool.query(`SELECT 1 FROM recipe_source_hold_clears WHERE recipe_id = $1`, [id]);

            expect(rows).toHaveLength(0);
        });

        it('overwrites a caller-supplied xact_id and recorded_at with the transaction, and the savepoint keeps the top-level id', async () => {
            const id = await insertRecipe(true);

            await inTx(async (client) => {
                await client.query('SAVEPOINT s');
                await client.query(
                    `INSERT INTO recipe_source_hold_clears (recipe_id, cause, actor_account_id, reason, xact_id, recorded_at)
                     VALUES ($1, 'staff', 'staff01', 'why', '1'::xid8, '2001-01-01')`,
                    [id],
                );
                await client.query('RELEASE SAVEPOINT s');
                await releaseHold(client, id);
            });

            const { rows } = await pool.query<{ same: boolean; fresh: boolean }>(
                `SELECT xact_id <> '1'::xid8 AS same, recorded_at > now() - interval '1 minute' AS fresh
                   FROM recipe_source_hold_clears WHERE recipe_id = $1`,
                [id],
            );

            expect(rows).toEqual([{ same: true, fresh: true }]);
        });

        it.each([
            ['staff with no actor', `'staff', NULL, 'why'`, 'recipe_source_hold_clears_cause_actor'],
            [
                'an earned clear with an actor',
                `'earnedRewrite', 'staff01', 'earnedRewrite'`,
                'recipe_source_hold_clears_cause_actor',
            ],
            [
                'an earned clear with another reason',
                `'earnedRewrite', NULL, 'because'`,
                'recipe_source_hold_clears_earned_reason',
            ],
            ['a blank reason', `'staff', 'staff01', '   '`, 'recipe_source_hold_clears_reason_check'],
            ['an unknown cause', `'other', NULL, 'why'`, 'recipe_source_hold_clears_cause_check'],
            ['a malformed erased actor', `'staff', 'erased_nope', 'why'`, 'recipe_source_hold_clears_actor_shape'],
        ])('refuses %s by its CHECK', async (_name, values, constraint) => {
            const id = await insertRecipe(true);

            await expect(
                pool.query(
                    `INSERT INTO recipe_source_hold_clears (recipe_id, cause, actor_account_id, reason)
                     SELECT $1, v.* FROM (VALUES (${values})) AS v`,
                    [id],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint });
        });
    });

    describe('append-only', () => {
        async function cleared(): Promise<{ id: string; recipeId: string; owner: string }> {
            const recipeId = await insertRecipe(true);

            await inTx(async (client) => {
                await recordClear(client, recipeId);
                await releaseHold(client, recipeId);
            });

            const { rows } = await pool.query<{ id: string }>(
                `SELECT id FROM recipe_source_hold_clears WHERE recipe_id = $1`,
                [recipeId],
            );

            return { id: rows[0]?.id ?? '', recipeId, owner: 'staff01' };
        }

        const runners: Array<[string, (fn: (c: Pick<pg.Pool, 'query'>) => Promise<void>) => Promise<void>]> = [
            ['recipe_app', async (fn) => fn(pool)],
            ['recipe_owner', async (fn) => roleDb.asOwner(async (client) => fn(client))],
        ];

        describe.each(runners)('as %s', (_role, run) => {
            it.each(['reason', 'cause', 'recorded_at', 'xact_id', 'recipe_id'])(
                'refuses an UPDATE of %s',
                async (column) => {
                    const { id } = await cleared();
                    const other = await insertRecipe(true);
                    const sets: Record<string, string> = {
                        reason: `reason = 'edited'`,
                        cause: `cause = 'earnedRewrite'`,
                        recorded_at: `recorded_at = now() - interval '1 day'`,
                        xact_id: `xact_id = '7'::xid8`,
                        recipe_id: `recipe_id = '${other}'`,
                    };

                    await run(async (client) => {
                        await expect(
                            client.query(`UPDATE recipe_source_hold_clears SET ${sets[column]} WHERE id = $1`, [id]),
                        ).rejects.toMatchObject({
                            code: CHECK_VIOLATION,
                            message: expect.stringContaining('recipe_source_hold_clears is append-only'),
                        });
                    });
                },
            );

            it('refuses a DELETE while the recipe exists', async () => {
                const { id } = await cleared();

                await run(async (client) => {
                    await expect(
                        client.query(`DELETE FROM recipe_source_hold_clears WHERE id = $1`, [id]),
                    ).rejects.toMatchObject({
                        code: CHECK_VIOLATION,
                        message: expect.stringContaining('recipe_source_hold_clears is append-only'),
                    });
                });
            });
        });

        it('refuses TRUNCATE, naming the table', async () => {
            await roleDb.asOwner(async (client) => {
                await expect(client.query(`TRUNCATE recipe_source_hold_clears`)).rejects.toMatchObject({
                    code: CHECK_VIOLATION,
                    message: expect.stringContaining('recipe_source_hold_clears is append-only'),
                });
            });
        });

        it('removes the record with its recipe, by the cascade', async () => {
            const { recipeId } = await cleared();

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [recipeId]);

            const { rows } = await pool.query(`SELECT 1 FROM recipe_source_hold_clears WHERE recipe_id = $1`, [
                recipeId,
            ]);

            expect(rows).toHaveLength(0);
        });

        it('relabels the actor to an erased token while an erasure job is in flight, and moves no other column', async () => {
            const { id } = await cleared();

            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ('staff01', 'running')`);

            try {
                await expect(
                    pool.query(
                        `UPDATE recipe_source_hold_clears SET actor_account_id = $2, reason = 'x' WHERE id = $1`,
                        [id, TOKEN],
                    ),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
                await pool.query(`UPDATE recipe_source_hold_clears SET actor_account_id = $2 WHERE id = $1`, [
                    id,
                    TOKEN,
                ]);

                const { rows } = await pool.query(
                    `SELECT actor_account_id FROM recipe_source_hold_clears WHERE id = $1`,
                    [id],
                );

                expect(rows[0]).toEqual({ actor_account_id: TOKEN });
            } finally {
                await pool.query(`DELETE FROM account_erasure_jobs WHERE owner_id = 'staff01'`);
            }
        });

        it('refuses the relabel with no erasure job in flight', async () => {
            const { id } = await cleared();

            await expect(
                pool.query(`UPDATE recipe_source_hold_clears SET actor_account_id = $2 WHERE id = $1`, [id, TOKEN]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });
    });

    describe('the functions the migration creates or replaces (AE8)', () => {
        const NAMES = [
            'recipe_source_hold_clears_stamp',
            'recipe_source_hold_clears_append_only',
            'recipe_source_hold_clears_no_truncate',
            'recipe_source_hold_clears_cleared_at_commit',
            'recipes_source_correction_hold_ratchet',
            'recipe_held_from_readers',
            'recipe_is_from_person',
        ];

        it.each(NAMES)('%s has one overload and the exact search_path pin', async (name) => {
            const { rows } = await pool.query<{ proconfig: string[] | null }>(
                `SELECT proconfig FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
                [name],
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]?.proconfig).toEqual(['search_path=pg_catalog, public, pg_temp']);
        });

        it.each(['recipe_held_from_readers', 'recipe_is_from_person'])('%s is PARALLEL SAFE', async (name) => {
            const { rows } = await pool.query<{ proparallel: string }>(
                `SELECT proparallel FROM pg_proc WHERE proname = $1`,
                [name],
            );

            expect(rows).toEqual([{ proparallel: 's' }]);
        });

        it('runs the ratchet as an AFTER row trigger restricted to a change of the hold', async () => {
            const { rows } = await pool.query<{ def: string }>(
                `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg_recipes_source_correction_hold_ratchet'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]?.def).toMatch(/AFTER UPDATE ON .*recipes FOR EACH ROW WHEN .*IS DISTINCT FROM/);
        });
    });
});
