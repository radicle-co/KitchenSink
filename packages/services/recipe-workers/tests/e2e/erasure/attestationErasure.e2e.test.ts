/**
 * Account erasure and `recipe_statement_attestations` (migrations 0088 and 0090), against a REAL Postgres.
 *
 * An attestation is kept while its recipe is public plus 6 years (ADR-0095 section 6), so erasure keeps EVERY row of the erased
 * account: the rows of a recipe it donates and the rows of a recipe it deletes. `account_id` becomes ONE random `erased_` token
 * per erasure, shared by every kept row of that account and linked to nothing else, and the rows of a deleted recipe lose their
 * `recipe_id` (the foreign key's `SET NULL`) and keep `recipe_ref`. The choice, wording version, locale and instant of each act
 * stay. The append-only trigger admits the swap only while the account's erasure job is queued or running.
 *
 * ⛔ A unit test over the emitted SQL cannot prove this: whether the trigger admits the swap, whether the foreign key keeps the
 * rows, and whether a second account's rows are left alone are all decided by the database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const USER_ERASED = '01JU89ATTESTERASED00000A0';
const USER_OTHER = '01JU89ATTESTOTHER000000B0';
const TOKEN_SHAPE = /^erased_[0-9a-f]{32}$/;

type AttestationRow = {
    readonly account_id: string;
    readonly choice: string;
    readonly wording_version: string | null;
    readonly locale: string | null;
    readonly recorded_at: string;
};

describe('erasure keeps and pseudonymises every attestation of the erased account (migrations 0088 and 0090)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${USER_ERASED}, ${USER_OTHER})`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_OTHER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** The erasure job the worker holds while it erases: the swap of `account_id` is admitted only while one is in flight. */
    async function startJob(ownerId: string): Promise<void> {
        await db.execute(sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${ownerId}, 'running')`);
    }

    async function insertRecipe(ownerId: string, visibility: 'public' | 'private'): Promise<string> {
        const { rows } = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status)
            VALUES (${ownerId}, 'attestation erasure probe', 'probe', 2, 5, 5, 10, ${visibility}, 'published')
            RETURNING id
        `);
        const id = rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the recipe insert returned no id');
        }

        return id;
    }

    async function attest(recipeId: string, accountId: string, choice: 'authored' | 'publicConfirm'): Promise<void> {
        const implicit = choice === 'publicConfirm';

        await db.execute(sql`
            INSERT INTO recipe_statement_attestations (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
            VALUES (${recipeId}, ${recipeId}, ${accountId}, ${implicit ? 'implicit' : 'explicit'}, ${choice},
                    ${implicit ? 'publicConfirm.v1' : 'statementAuthored.v1'}, 'en', 'create')
        `);
    }

    async function rowsOf(recipeId: string): Promise<AttestationRow[]> {
        const { rows } = await db.execute<AttestationRow>(sql`
            SELECT account_id, choice, wording_version, locale, recorded_at::text AS recorded_at
              FROM recipe_statement_attestations WHERE recipe_ref = ${recipeId} ORDER BY choice
        `);

        return rows;
    }

    // Rewritten for 0090: the rows of a removed recipe used to go with it. They are now kept, tokenised like the rest.
    it('keeps the rows of a removed recipe and of a donated one, tokenises all with one shared token, and leaves other accounts alone', async () => {
        const kept = await insertRecipe(USER_ERASED, 'private');
        const keptToo = await insertRecipe(USER_ERASED, 'private');
        const removed = await insertRecipe(USER_ERASED, 'private');
        const others = await insertRecipe(USER_OTHER, 'public');

        for (const id of [kept, keptToo, removed]) {
            await attest(id, USER_ERASED, 'authored');
            await attest(id, USER_ERASED, 'publicConfirm');
        }

        await attest(others, USER_OTHER, 'authored');

        await startJob(USER_ERASED);

        const before = await rowsOf(kept);
        const otherBefore = await rowsOf(others);

        // The cook donates two of the three; the third is removed with the owner-only set.
        await eraseRecipeRows(db, USER_ERASED, [kept, keptToo]);

        const afterRemoved = await rowsOf(removed);

        expect(afterRemoved).toHaveLength(2);
        // The recipe is gone and the rows name it still, by `recipe_ref`.
        const { rows: orphaned } = await db.execute<{ n: string }>(sql`
            SELECT count(*) AS n FROM recipe_statement_attestations WHERE recipe_ref = ${removed} AND recipe_id IS NULL
        `);

        expect(Number(orphaned[0]?.n)).toBe(2);

        const afterKept = await rowsOf(kept);
        const afterKeptToo = await rowsOf(keptToo);
        const tokens = new Set([...afterKept, ...afterKeptToo, ...afterRemoved].map((row) => row.account_id));

        expect(afterKept).toHaveLength(2);
        expect(afterKeptToo).toHaveLength(2);
        expect(tokens.size).toBe(1);
        expect([...tokens][0]).toMatch(TOKEN_SHAPE);
        // Everything but the account is as the cook left it.
        expect(afterKept.map(({ account_id: _account, ...rest }) => rest)).toEqual(
            before.map(({ account_id: _account, ...rest }) => rest),
        );
        // Nothing of the erased account's id remains on any row.
        const { rows: stillNamed } = await db.execute<{ n: string }>(sql`
            SELECT count(*) AS n FROM recipe_statement_attestations WHERE account_id = ${USER_ERASED}
        `);

        expect(Number(stillNamed[0]?.n)).toBe(0);
        expect(await rowsOf(others)).toEqual(otherBefore);
    });

    it('gives each erasure its own token, and a replay finds nothing left to swap and succeeds', async () => {
        const mine = await insertRecipe(USER_ERASED, 'private');
        const theirs = await insertRecipe(USER_OTHER, 'private');

        await attest(mine, USER_ERASED, 'authored');
        await attest(theirs, USER_OTHER, 'authored');
        await startJob(USER_ERASED);
        await startJob(USER_OTHER);

        await eraseRecipeRows(db, USER_ERASED, [mine]);
        await eraseRecipeRows(db, USER_OTHER, [theirs]);

        const first = (await rowsOf(mine))[0]?.account_id;
        const second = (await rowsOf(theirs))[0]?.account_id;

        expect(first).toMatch(TOKEN_SHAPE);
        expect(second).toMatch(TOKEN_SHAPE);
        expect(first).not.toBe(second);

        await expect(eraseRecipeRows(db, USER_ERASED, [mine])).resolves.toBeDefined();
        expect((await rowsOf(mine))[0]?.account_id).toBe(first);
    });

    it('refuses the swap when no erasure job is in flight for the account, and rolls the whole erasure back', async () => {
        const mine = await insertRecipe(USER_ERASED, 'private');

        await attest(mine, USER_ERASED, 'authored');

        await expect(eraseRecipeRows(db, USER_ERASED, [])).rejects.toMatchObject({});

        // Nothing moved: the recipe and the row are as they were, because the transaction rolled back.
        expect(await rowsOf(mine)).toHaveLength(1);
        expect((await rowsOf(mine))[0]?.account_id).toBe(USER_ERASED);

        const { rows } = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM recipes WHERE id = ${mine}`);

        expect(Number(rows[0]?.n)).toBe(1);
    });

    // The donate step reads `recipe_is_from_person`, which counts a past attestation when the statement was cleared.
    it('does not donate a recipe whose statement was cleared after "from another person", and keeps its rows', async () => {
        const cleared = await insertRecipe(USER_ERASED, 'private');

        await db.execute(sql`
            INSERT INTO recipe_statement_attestations (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
            VALUES (${cleared}, ${cleared}, ${USER_ERASED}, 'explicit', 'fromPerson', 'statementFromPerson.v1', 'en', 'update')
        `);
        await startJob(USER_ERASED);

        await eraseRecipeRows(db, USER_ERASED, [cleared]);

        const { rows } = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM recipes WHERE id = ${cleared}`);

        expect(Number(rows[0]?.n)).toBe(0);
        expect(await rowsOf(cleared)).toHaveLength(1);
    });
});
