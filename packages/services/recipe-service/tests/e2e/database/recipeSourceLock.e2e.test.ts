/**
 * Migration 0092 — the persisted facts behind the source lock (P8, plan everyAnswerSourceLock U1), asserted against a real
 * PostgreSQL as the SERVICE role (ADR-0039, ADR-0100).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a trigger that did not fire, a CHECK the migration never added or
 * a cascade the guard swallowed. What is asserted:
 *
 *  1. CONFIRMED. `source_confirmed_at` is set by the database when a recipe is first published (an insert as published, an
 *     update to published), keeps an earlier value, never changes once set, and a published row cannot have it NULL.
 *  2. HOLD. `source_correction_hold` only goes false to true, a held recipe cannot be public by any writer, and a clone of a
 *     held recipe is inserted held.
 *  3. RECORD. `recipe_source_corrections` is append-only for every role. It admits the cascade of a deleted recipe and ONE
 *     update, the erasure relabel of the actor, which moves no other column and needs an erasure job in flight.
 *  4. EVIDENCE. A correction's evidence row (capture `staffCorrection`) inserts, and a stated source with no evidence row
 *     still cannot COMMIT.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const CHECK_VIOLATION = '23514';
const TOKEN = `erased_${'d4'.repeat(16)}`;

describe('the source lock schema (migration 0092)', () => {
    let RECIPE_ID: string;
    let OWNER_ID: string;
    let pool: pg.Pool;
    const created: string[] = [];

    beforeEach(() => {
        RECIPE_ID = randomUUID();
        OWNER_ID = `01JU7LOCK${RECIPE_ID.slice(0, 10)}`;
        created.push(RECIPE_ID);
    });

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM account_erasure_jobs WHERE owner_id = $1`, [OWNER_ID]);
        // A held clone and its parent: delete clones first, so no cascade or foreign key meets a half-deleted tree.
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[]) AND cloned_from_id IS NOT NULL`, [created]);
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [created]);
        created.length = 0;
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertRecipe(
        over: {
            id?: string;
            status?: 'draft' | 'published';
            visibility?: 'private' | 'public';
            sourceConfirmedAt?: string | null;
            hold?: boolean;
            clonedFromId?: string | null;
            sourceType?: string;
            sourceKind?: string | null;
            sourceUrl?: string | null;
        } = {},
    ): Promise<string> {
        const id = over.id ?? RECIPE_ID;

        if (over.id !== undefined) {
            created.push(id);
        }

        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, source_type, source_kind, source_url,
                                  cloned_from_id, statement_kind, source_confirmed_at, source_correction_hold)
             VALUES ($1, $2, 'Lock suite', '', 1, 1, 2, 4, $3, $4, $5, $6, $7, $8,
                     CASE WHEN $6::text IS NULL THEN NULL ELSE 'source' END, $9, $10)`,
            [
                id,
                OWNER_ID,
                over.visibility ?? 'private',
                over.status ?? 'draft',
                over.sourceType ?? 'user_created',
                over.sourceKind ?? null,
                over.sourceUrl ?? null,
                over.clonedFromId ?? null,
                over.sourceConfirmedAt ?? null,
                over.hold ?? false,
            ],
        );

        return id;
    }

    async function recipeRow(id: string = RECIPE_ID): Promise<{
        first_published_at: Date | null;
        source_confirmed_at: Date | null;
        source_correction_hold: boolean;
    }> {
        const { rows } = await pool.query<{
            first_published_at: Date | null;
            source_confirmed_at: Date | null;
            source_correction_hold: boolean;
        }>(`SELECT first_published_at, source_confirmed_at, source_correction_hold FROM recipes WHERE id = $1`, [id]);

        expect(rows).toHaveLength(1);

        return rows[0];
    }

    describe('source_confirmed_at', () => {
        it('is set to the first publish when a recipe is INSERTED as published (an import saved as published)', async () => {
            await insertRecipe({ status: 'published' });

            const row = await recipeRow();

            expect(row.first_published_at).not.toBeNull();
            expect(row.source_confirmed_at).toEqual(row.first_published_at);
        });

        it('is set to the first publish when a draft is updated to published', async () => {
            await insertRecipe();
            expect((await recipeRow()).source_confirmed_at).toBeNull();

            await pool.query(`UPDATE recipes SET status = 'published' WHERE id = $1`, [RECIPE_ID]);

            const row = await recipeRow();

            expect(row.source_confirmed_at).not.toBeNull();
            expect(row.source_confirmed_at).toEqual(row.first_published_at);
        });

        it('keeps an earlier value through the first publish, and raises nothing', async () => {
            await insertRecipe({ sourceConfirmedAt: '2026-01-02T03:04:05Z' });

            await pool.query(`UPDATE recipes SET status = 'published' WHERE id = $1`, [RECIPE_ID]);

            const row = await recipeRow();

            expect(row.source_confirmed_at?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
            expect(row.first_published_at?.toISOString()).not.toBe('2026-01-02T03:04:05.000Z');
        });

        it('keeps its value when a confirmed draft is saved as a draft again', async () => {
            await insertRecipe({ sourceConfirmedAt: '2026-01-02T03:04:05Z' });

            await pool.query(`UPDATE recipes SET title = 'Renamed', status = 'draft' WHERE id = $1`, [RECIPE_ID]);

            expect((await recipeRow()).source_confirmed_at?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
        });

        it('allows NULL to a value on a draft (a Make public with a statement confirms it)', async () => {
            await insertRecipe();

            await pool.query(
                `UPDATE recipes SET source_confirmed_at = COALESCE(source_confirmed_at, now()) WHERE id = $1`,
                [RECIPE_ID],
            );

            expect((await recipeRow()).source_confirmed_at).not.toBeNull();
        });

        it('raises when a direct UPDATE clears it', async () => {
            await insertRecipe({ sourceConfirmedAt: '2026-01-02T03:04:05Z' });

            await expect(
                pool.query(`UPDATE recipes SET source_confirmed_at = NULL WHERE id = $1`, [RECIPE_ID]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('raises when a direct UPDATE changes it to another value', async () => {
            await insertRecipe({ sourceConfirmedAt: '2026-01-02T03:04:05Z' });

            await expect(
                pool.query(`UPDATE recipes SET source_confirmed_at = '2026-02-02T00:00:00Z' WHERE id = $1`, [
                    RECIPE_ID,
                ]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('raises on a published row whose value is NULL (the CHECK, with the ratchet off for one transaction)', async () => {
            await insertRecipe({ status: 'published' });

            await roleDb.asOwner(async (client) => {
                await client.query('BEGIN');
                await client.query(`ALTER TABLE recipes DISABLE TRIGGER trg_recipes_source_confirmed_ratchet`);
                await expect(
                    client.query(`UPDATE recipes SET source_confirmed_at = NULL WHERE id = $1`, [RECIPE_ID]),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
                await client.query('ROLLBACK');
            });
        });
    });

    describe('source_correction_hold', () => {
        it('goes false to true, and never back', async () => {
            await insertRecipe();

            await pool.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [RECIPE_ID]);
            expect((await recipeRow()).source_correction_hold).toBe(true);

            await expect(
                pool.query(`UPDATE recipes SET source_correction_hold = false WHERE id = $1`, [RECIPE_ID]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('refuses visibility public on a held row, for any writer', async () => {
            await insertRecipe({ hold: true });

            await expect(
                pool.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [RECIPE_ID]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('refuses to hold a recipe that is public', async () => {
            await insertRecipe({ visibility: 'public' });

            await expect(
                pool.query(`UPDATE recipes SET source_correction_hold = true WHERE id = $1`, [RECIPE_ID]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('inserts a clone of a held recipe held, and a clone of an unheld recipe unheld', async () => {
            await insertRecipe({ hold: true });
            const heldClone = await insertRecipe({ id: randomUUID(), clonedFromId: RECIPE_ID });

            expect((await recipeRow(heldClone)).source_correction_hold).toBe(true);

            const open = await insertRecipe({ id: randomUUID() });
            const openClone = await insertRecipe({ id: randomUUID(), clonedFromId: open });

            expect((await recipeRow(openClone)).source_correction_hold).toBe(false);
        });

        it('cannot be undone by a clone insert that states hold false', async () => {
            await insertRecipe({ hold: true });
            const clone = await insertRecipe({ id: randomUUID(), clonedFromId: RECIPE_ID, hold: false });

            expect((await recipeRow(clone)).source_correction_hold).toBe(true);
        });
    });

    describe('recipe_source_corrections', () => {
        async function record(over: { actor?: string; reason?: string; ground?: string } = {}): Promise<string> {
            const { rows } = await pool.query<{ id: string }>(
                `INSERT INTO recipe_source_corrections
                     (recipe_id, actor_account_id, old_source_type, new_source_type, old_statement_kind,
                      new_statement_kind, ground, reason)
                 VALUES ($1, $2, 'user_created', 'user_created', 'authored', 'source', $3, $4)
                 RETURNING id`,
                [
                    RECIPE_ID,
                    over.actor ?? OWNER_ID,
                    over.ground ?? 'ownerConfirmedByAccountEmail',
                    over.reason ?? 'wrong answer',
                ],
            );

            expect(rows).toHaveLength(1);

            return rows[0].id;
        }

        it('lets the service role INSERT and SELECT a record', async () => {
            await insertRecipe();
            const id = await record();

            const { rows } = await pool.query(`SELECT reason FROM recipe_source_corrections WHERE id = $1`, [id]);

            expect(rows).toHaveLength(1);
        });

        it('raises on UPDATE of any column and on DELETE, for the service role', async () => {
            await insertRecipe();
            const id = await record();

            await expect(
                pool.query(`UPDATE recipe_source_corrections SET reason = 'edited' WHERE id = $1`, [id]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(pool.query(`DELETE FROM recipe_source_corrections WHERE id = $1`, [id])).rejects.toMatchObject(
                { code: CHECK_VIOLATION },
            );
        });

        it('is removed with its recipe, by the cascade', async () => {
            await insertRecipe();
            await record();

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            const { rows } = await pool.query(`SELECT 1 FROM recipe_source_corrections WHERE recipe_id = $1`, [
                RECIPE_ID,
            ]);

            expect(rows).toHaveLength(0);
        });

        it('refuses TRUNCATE', async () => {
            await roleDb.asOwner(async (client) => {
                await expect(client.query(`TRUNCATE recipe_source_corrections`)).rejects.toMatchObject({
                    code: CHECK_VIOLATION,
                });
            });
        });

        it('relabels the actor to an erased token while an erasure job is in flight', async () => {
            await insertRecipe();
            const id = await record();
            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, 'running')`, [OWNER_ID]);

            await pool.query(`UPDATE recipe_source_corrections SET actor_account_id = $2 WHERE id = $1`, [id, TOKEN]);

            const { rows } = await pool.query<{ actor_account_id: string }>(
                `SELECT actor_account_id FROM recipe_source_corrections WHERE id = $1`,
                [id],
            );

            expect(rows[0].actor_account_id).toBe(TOKEN);
        });

        it('refuses the relabel with no erasure job in flight', async () => {
            await insertRecipe();
            const id = await record();

            await expect(
                pool.query(`UPDATE recipe_source_corrections SET actor_account_id = $2 WHERE id = $1`, [id, TOKEN]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('refuses a relabel that also changes another column (qse Q-2)', async () => {
            await insertRecipe();
            const id = await record();
            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, 'running')`, [OWNER_ID]);

            await expect(
                pool.query(
                    `UPDATE recipe_source_corrections SET actor_account_id = $2, reason = 'rewritten' WHERE id = $1`,
                    [id, TOKEN],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(
                pool.query(
                    `UPDATE recipe_source_corrections SET actor_account_id = $2, new_statement_kind = 'book' WHERE id = $1`,
                    [id, TOKEN],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('admits no erased_ value except the token shape, and no ground outside the closed set', async () => {
            await insertRecipe();

            await expect(record({ actor: 'erased_nothex' })).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(record({ ground: 'somethingElse' })).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(record({ reason: '' })).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(record({ reason: 'x'.repeat(1001) })).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });
    });

    describe('evidence for a correction', () => {
        /** One transaction: a stated book or paid-site recipe, and (when given) an evidence row with this capture. */
        async function commitStated(kind: 'book' | 'paid_site', capture: string | null): Promise<void> {
            const client = await pool.connect();

            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                          total_time_minutes, servings, visibility, status, source_type, source_kind,
                                          statement_kind, source_attribution)
                     VALUES ($1, $2, 'Stated', '', 1, 1, 2, 4, 'private', 'draft', $3, $4, 'source', 'Jolene')`,
                    [RECIPE_ID, OWNER_ID, kind === 'book' ? 'imported_physical' : 'imported_paid', kind],
                );

                if (capture !== null) {
                    await client.query(
                        `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                         VALUES ($1, $2, $3, 'Jolene')`,
                        [RECIPE_ID, capture, kind],
                    );
                }

                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }
        }

        it.each(['book', 'paid_site'] as const)('accepts capture staffCorrection for a stated %s', async (kind) => {
            await expect(commitStated(kind, 'staffCorrection')).resolves.toBeUndefined();

            const { rows } = await pool.query(`SELECT capture FROM recipe_source_evidence WHERE recipe_id = $1`, [
                RECIPE_ID,
            ]);

            expect(rows).toEqual([{ capture: 'staffCorrection' }]);
        });

        it('still refuses a stated source with no evidence row at COMMIT', async () => {
            await expect(commitStated('book', null)).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('refuses a capture outside the closed set', async () => {
            await expect(commitStated('book', 'someoneElse')).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });
    });
});
