/**
 * Account erasure and the source lock's two facts (migration 0092, ADR-0100), against a REAL Postgres.
 *
 *  1. A recipe held off Public by a staff correction is never DONATED: the donation sets `visibility = 'public'`, and nothing in
 *     the database stops it (the CHECK was dropped in migration 0099), so the erasure's own held terms keep it out: the flip's term
 *     is pinned by the exact-SQL unit test, and this e2e guards the removal set's term. The
 *     held recipe is removed with the owner-only set instead; the same recipe unheld is donated.
 *  2. A staff account's erasure relabels the `actor_account_id` of every correction it made, on recipes that belong to OTHER
 *     owners and survive, to ONE `erased_` token. The append-only trigger admits that swap only while the job is in flight.
 *  3. A removed recipe takes its correction records with it (the cascade).
 *
 * ⛔ A unit test over the emitted SQL cannot prove any of this: whether the CHECK would have refused the donation, and
 * whether the trigger admits the relabel, are decided by the database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const COOK = '01JU92SRCLOCKCOOK0000000A';
const OTHER_COOK = '01JU92SRCLOCKOTHER000000B';
const STAFF = '01JU92SRCLOCKSTAFF000000C';
const TOKEN_SHAPE = /^erased_[0-9a-f]{32}$/;

describe('erasure and the source lock (migration 0092)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${COOK}, ${OTHER_COOK})`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${COOK}, ${OTHER_COOK}, ${STAFF})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function startJob(ownerId: string): Promise<void> {
        await db.execute(sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${ownerId}, 'running')`);
    }

    /** A cook-written ("I wrote this") private recipe, optionally held. */
    async function insertOwn(ownerId: string, held: boolean): Promise<string> {
        const { rows } = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status, statement_kind, source_correction_hold)
            VALUES (${ownerId}, 'source lock erasure probe', 'probe', 2, 5, 5, 10, 'private', 'published', 'authored', ${held})
            RETURNING id
        `);
        const id: unknown = rows[0]?.id;

        if (typeof id !== 'string') {
            throw new Error('test setup: the recipe insert returned no id');
        }

        return id;
    }

    async function correct(recipeId: string, actor: string): Promise<void> {
        await db.execute(sql`
            INSERT INTO recipe_source_corrections (recipe_id, actor_account_id, old_source_type, new_source_type,
                                                   old_statement_kind, new_statement_kind, ground, reason)
            VALUES (${recipeId}, ${actor}, 'user_created', 'user_created', 'source', 'authored',
                    'ownerConfirmedByAccountEmail', 'wrong answer')
        `);
    }

    async function visibilityOf(recipeId: string): Promise<string | undefined> {
        const { rows } = await db.execute<{ visibility: string }>(
            sql`SELECT visibility FROM recipes WHERE id = ${recipeId}`,
        );

        return rows[0]?.visibility;
    }

    it('does not donate a held recipe, and the erasure still completes; the same recipe unheld is donated', async () => {
        const held = await insertOwn(COOK, true);
        const open = await insertOwn(COOK, false);

        await startJob(COOK);
        await eraseRecipeRows(db, COOK, [held, open]);

        expect(await visibilityOf(held)).toBeUndefined();
        expect(await visibilityOf(open)).toBe('public');
    });

    it('relabels a staff account to one erased token on a recipe another owner keeps, and leaves other staff alone', async () => {
        const kept = await insertOwn(OTHER_COOK, false);
        const keptToo = await insertOwn(OTHER_COOK, false);

        await correct(kept, STAFF);
        await correct(keptToo, STAFF);
        await correct(keptToo, 'someoneElseStaff00000000000');
        await startJob(STAFF);

        await eraseRecipeRows(db, STAFF, []);

        const { rows } = await db.execute<{ actor_account_id: string }>(sql`
            SELECT actor_account_id FROM recipe_source_corrections WHERE recipe_id IN (${kept}, ${keptToo})
             ORDER BY actor_account_id
        `);
        const relabelled = rows.filter((row) => TOKEN_SHAPE.test(row.actor_account_id));

        expect(relabelled).toHaveLength(2);
        expect(new Set(relabelled.map((row) => row.actor_account_id)).size).toBe(1);
        expect(rows.map((row) => row.actor_account_id)).toContain('someoneElseStaff00000000000');
        expect(rows.map((row) => row.actor_account_id)).not.toContain(STAFF);
    });

    it('removes the correction records of a removed recipe with it', async () => {
        const removed = await insertOwn(COOK, true);

        await correct(removed, STAFF);
        await startJob(COOK);
        await eraseRecipeRows(db, COOK, []);

        const { rows } = await db.execute<{ n: string }>(sql`
            SELECT count(*) AS n FROM recipe_source_corrections WHERE recipe_id = ${removed}
        `);

        expect(Number(rows[0]?.n)).toBe(0);
    });

    /** A staff clear of a held recipe: the record's own trigger refuses a clear of a recipe that is not held. */
    async function clearByStaffRecord(recipeId: string, actor: string): Promise<void> {
        await db.transaction(async (tx) => {
            await tx.execute(sql`
                INSERT INTO recipe_source_hold_clears (recipe_id, cause, actor_account_id, reason, recorded_at, xact_id)
                VALUES (${recipeId}, 'staff', ${actor}, 'a mistaken correction', now(), pg_current_xact_id())
            `);
            await tx.execute(sql`UPDATE recipes SET source_correction_hold = false WHERE id = ${recipeId}`);
        });
    }

    it('relabels a staff account on its hold-clear records to one erased token, and leaves another staff account alone', async () => {
        const first = await insertOwn(OTHER_COOK, true);
        const second = await insertOwn(OTHER_COOK, true);

        await clearByStaffRecord(first, STAFF);
        await clearByStaffRecord(second, 'someoneElseStaff00000000000');
        await startJob(STAFF);

        await eraseRecipeRows(db, STAFF, []);

        const { rows } = await db.execute<{ actor_account_id: string }>(sql`
            SELECT actor_account_id FROM recipe_source_hold_clears WHERE recipe_id IN (${first}, ${second})
             ORDER BY actor_account_id
        `);
        const actors = rows.map((row) => row.actor_account_id);

        expect(actors).toContain('someoneElseStaff00000000000');
        expect(actors).not.toContain(STAFF);
        expect(actors.filter((actor) => TOKEN_SHAPE.test(actor))).toHaveLength(1);
    });

    it('removes the hold-clear records of a removed recipe with it', async () => {
        const removed = await insertOwn(COOK, true);

        await clearByStaffRecord(removed, STAFF);
        await startJob(COOK);
        await eraseRecipeRows(db, COOK, []);

        const { rows } = await db.execute<{ n: string }>(sql`
            SELECT count(*) AS n FROM recipe_source_hold_clears WHERE recipe_id = ${removed}
        `);

        expect(Number(rows[0]?.n)).toBe(0);
    });

    it('refuses the relabel when no erasure job is in flight for the staff account, and rolls the erasure back', async () => {
        const kept = await insertOwn(OTHER_COOK, false);

        await correct(kept, STAFF);

        await expect(eraseRecipeRows(db, STAFF, [])).rejects.toMatchObject({});

        const { rows } = await db.execute<{ actor_account_id: string }>(sql`
            SELECT actor_account_id FROM recipe_source_corrections WHERE recipe_id = ${kept}
        `);

        expect(rows[0]?.actor_account_id).toBe(STAFF);
    });
});
