/**
 * Account erasure and `recipe_statement_attestations` (migration 0088), against a REAL Postgres.
 *
 * A recipe erasure removes takes its attestation rows by the cascade. A recipe it keeps (a donated one) keeps its rows, but
 * `account_id` becomes ONE random `erased_` token per erasure, shared by every kept row of that account and linked to nothing
 * else. The choice, wording version, locale and instant of each act stay. The append-only trigger admits that one UPDATE.
 *
 * ⛔ A unit test over the emitted SQL cannot prove this: whether the trigger admits the swap, whether the cascade still
 * passes, and whether a second account's rows are left alone are all decided by the database.
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

describe('erasure pseudonymises the attestations of the recipes it keeps (migration 0088)', () => {
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
            INSERT INTO recipe_statement_attestations (recipe_id, account_id, mode, choice, wording_version, locale, action)
            VALUES (${recipeId}, ${accountId}, ${implicit ? 'implicit' : 'explicit'}, ${choice},
                    ${implicit ? 'publicConfirm.v1' : 'statementAuthored.v1'}, 'en', 'create')
        `);
    }

    async function rowsOf(recipeId: string): Promise<AttestationRow[]> {
        const { rows } = await db.execute<AttestationRow>(sql`
            SELECT account_id, choice, wording_version, locale, recorded_at::text AS recorded_at
              FROM recipe_statement_attestations WHERE recipe_id = ${recipeId} ORDER BY choice
        `);

        return rows;
    }

    it('removes the rows of a removed recipe, tokenises the rows of a donated one with one shared token, and leaves other accounts alone', async () => {
        const kept = await insertRecipe(USER_ERASED, 'private');
        const keptToo = await insertRecipe(USER_ERASED, 'private');
        const removed = await insertRecipe(USER_ERASED, 'private');
        const others = await insertRecipe(USER_OTHER, 'public');

        for (const id of [kept, keptToo, removed]) {
            await attest(id, USER_ERASED, 'authored');
            await attest(id, USER_ERASED, 'publicConfirm');
        }

        await attest(others, USER_OTHER, 'authored');

        const before = await rowsOf(kept);
        const otherBefore = await rowsOf(others);

        // The cook donates two of the three; the third is removed with the owner-only set.
        await eraseRecipeRows(db, USER_ERASED, [kept, keptToo]);

        expect(await rowsOf(removed)).toEqual([]);

        const afterKept = await rowsOf(kept);
        const afterKeptToo = await rowsOf(keptToo);
        const tokens = new Set([...afterKept, ...afterKeptToo].map((row) => row.account_id));

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
});
