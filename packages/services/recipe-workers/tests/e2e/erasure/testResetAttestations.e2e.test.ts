/**
 * The test-principal reset and `recipe_statement_attestations` (migration 0090), against a REAL Postgres.
 *
 * A test principal keeps nothing, so a reset deletes its statement records too. The records of every other account are
 * append-only, and the database refuses to delete them. It makes one exception: the account's own test reset, while that
 * reset is running.
 *
 * ⛔ A unit test over the emitted SQL cannot prove this: whether the trigger admits the delete only while the reset runs,
 * and whether a bystander's rows survive, are decided by the database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { purgeTestPrincipalRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const PRINCIPAL = '01JU95TESTRESETATTEST0A0';
const BYSTANDER = '01JU95TESTRESETATTEST0B0';

describe('a test-principal reset deletes the principal’s statement records (migration 0090)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM test_reset_jobs WHERE user_id IN (${PRINCIPAL}, ${BYSTANDER})`);
        // The rows are append-only: a running reset is the only way to clear them, so each account gets one for the sweep.
        await db.execute(sql`
            INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running'), (${BYSTANDER}, 'running')
        `);
        await db.execute(sql`DELETE FROM recipe_statement_attestations WHERE account_id IN (${PRINCIPAL}, ${BYSTANDER})`);
        await db.execute(sql`DELETE FROM test_reset_jobs WHERE user_id IN (${PRINCIPAL}, ${BYSTANDER})`);
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${PRINCIPAL}, ${BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertRecipe(ownerId: string): Promise<string> {
        const { rows } = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status)
            VALUES (${ownerId}, 'reset attestation probe', 'probe', 2, 5, 5, 10, 'private', 'published')
            RETURNING id
        `);
        const id = rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the recipe insert returned no id');
        }

        return id;
    }

    async function attest(recipeId: string, accountId: string): Promise<void> {
        await db.execute(sql`
            INSERT INTO recipe_statement_attestations (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
            VALUES (${recipeId}, ${recipeId}, ${accountId}, 'explicit', 'authored', 'statementAuthored.v1', 'en', 'create')
        `);
    }

    async function countFor(accountId: string): Promise<number> {
        const { rows } = await db.execute<{ n: string }>(sql`
            SELECT count(*) AS n FROM recipe_statement_attestations WHERE account_id = ${accountId}
        `);

        return Number(rows[0]?.n);
    }

    it('deletes every record of the principal, keeps every record of another account', async () => {
        const mine = await insertRecipe(PRINCIPAL);
        const theirs = await insertRecipe(BYSTANDER);

        await attest(mine, PRINCIPAL);
        await attest(mine, PRINCIPAL);
        await attest(theirs, BYSTANDER);
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running')`);

        await purgeTestPrincipalRows(db, PRINCIPAL);

        expect(await countFor(PRINCIPAL)).toBe(0);
        expect(await countFor(BYSTANDER)).toBe(1);
    });

    it('refuses a delete of the same rows when no reset is running for the account', async () => {
        const mine = await insertRecipe(PRINCIPAL);

        await attest(mine, PRINCIPAL);

        await expect(
            db.execute(sql`DELETE FROM recipe_statement_attestations WHERE account_id = ${PRINCIPAL}`),
        ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });

        // A queued reset has not started: only a running one may delete.
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'queued')`);

        await expect(
            db.execute(sql`DELETE FROM recipe_statement_attestations WHERE account_id = ${PRINCIPAL}`),
        ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
        expect(await countFor(PRINCIPAL)).toBe(1);
    });

    it('a running reset for one account does not let another account’s rows go', async () => {
        const theirs = await insertRecipe(BYSTANDER);

        await attest(theirs, BYSTANDER);
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running')`);

        await expect(
            db.execute(sql`DELETE FROM recipe_statement_attestations WHERE account_id = ${BYSTANDER}`),
        ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    });
});
