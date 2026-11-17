/**
 * The test-principal reset and `recipe_statement_attestations` (migration 0090), against a REAL Postgres.
 *
 * The statement records are append-only and the database refuses every DELETE, for every role. A reset of a test principal
 * relabels them instead: `account_id` moves to one `erased_` token, so the record stays and who made it does not. The
 * database admits that swap only for a registered test principal, and only while its reset is running.
 *
 * ⛔ A unit test over the emitted SQL cannot prove this: whether the trigger admits the swap only while the reset runs,
 * and whether a bystander's rows stay as they were, are decided by the database.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { randomBytes } from 'node:crypto';

import { purgeTestPrincipalRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const PRINCIPAL = '01JU95TESTRESETATTEST0A0';
const BYSTANDER = '01JU95TESTRESETATTEST0B0';

describe('a test-principal reset relabels the principal’s statement records and deletes none (migration 0090)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    beforeEach(async () => {
        // Only the principal is registered: the bystander is an ordinary account.
        await db.execute(sql`INSERT INTO test_principals (user_id) VALUES (${PRINCIPAL}) ON CONFLICT DO NOTHING`);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM test_reset_jobs WHERE user_id IN (${PRINCIPAL}, ${BYSTANDER})`);
        // The rows are append-only and cannot be deleted: the sweep relabels both accounts' rows, which a registered principal
        // with a running reset may do. Rows stay behind under a token no later run reads.
        await db.execute(sql`
            INSERT INTO test_principals (user_id) VALUES (${BYSTANDER}) ON CONFLICT DO NOTHING
        `);
        await db.execute(sql`
            INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running'), (${BYSTANDER}, 'running')
        `);
        await db.execute(sql`
            UPDATE recipe_statement_attestations SET account_id = ${`erased_${randomBytes(16).toString('hex')}`}
             WHERE account_id IN (${PRINCIPAL}, ${BYSTANDER})
        `);
        await db.execute(sql`DELETE FROM test_reset_jobs WHERE user_id IN (${PRINCIPAL}, ${BYSTANDER})`);
        await db.execute(sql`DELETE FROM test_principals WHERE user_id IN (${PRINCIPAL}, ${BYSTANDER})`);
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

    async function accountsOf(recipeId: string): Promise<string[]> {
        const { rows } = await db.execute<{ account_id: string }>(sql`
            SELECT account_id FROM recipe_statement_attestations WHERE recipe_ref = ${recipeId} ORDER BY id
        `);

        return rows.map((row) => row.account_id);
    }

    it('leaves every record of the principal under one erased token, and every record of another account as it was', async () => {
        const mine = await insertRecipe(PRINCIPAL);
        const theirs = await insertRecipe(BYSTANDER);

        await attest(mine, PRINCIPAL);
        await attest(mine, PRINCIPAL);
        await attest(theirs, BYSTANDER);
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running')`);

        await purgeTestPrincipalRows(db, PRINCIPAL);

        const tokens = await accountsOf(mine);

        // The recipe went, and its records stayed with no recipe_id: relabelled, not deleted.
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toMatch(/^erased_[0-9a-f]{32}$/);
        expect(new Set(tokens).size).toBe(1);
        expect(await countFor(PRINCIPAL)).toBe(0);
        expect(await accountsOf(theirs)).toEqual([BYSTANDER]);
    });

    it('refuses a DELETE of the principal’s records for the service role and the owner, even while its reset runs', async () => {
        const mine = await insertRecipe(PRINCIPAL);

        await attest(mine, PRINCIPAL);
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running')`);

        await expect(
            db.execute(sql`DELETE FROM recipe_statement_attestations WHERE account_id = ${PRINCIPAL}`),
        ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
        await expect(
            roleDb.asOwner((client) =>
                client.query(`DELETE FROM recipe_statement_attestations WHERE account_id = $1`, [PRINCIPAL]),
            ),
        ).rejects.toMatchObject({ message: expect.stringMatching(/append-only/) });
        expect(await countFor(PRINCIPAL)).toBe(1);
    });

    const swapOf = (account: string): Promise<unknown> =>
        db.execute(sql`UPDATE recipe_statement_attestations SET account_id = 'erased_00000000000000000000000000000000'
                        WHERE account_id = ${account}`);

    it('refuses the swap of the same rows when no reset is running for the account', async () => {
        const mine = await insertRecipe(PRINCIPAL);

        await attest(mine, PRINCIPAL);

        await expect(swapOf(PRINCIPAL)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });

        // A queued reset has not started: only a running one may swap.
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'queued')`);

        await expect(swapOf(PRINCIPAL)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
        expect(await countFor(PRINCIPAL)).toBe(1);
    });

    it('a running reset for one account does not let another account’s rows be relabelled', async () => {
        const theirs = await insertRecipe(BYSTANDER);

        await attest(theirs, BYSTANDER);
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${PRINCIPAL}, 'running')`);

        await expect(swapOf(BYSTANDER)).rejects.toMatchObject({
            cause: { message: expect.stringMatching(/append-only/) },
        });
    });

    it('refuses the swap for an account that is not a registered test principal, even while a reset job runs for it', async () => {
        const theirs = await insertRecipe(BYSTANDER);

        await attest(theirs, BYSTANDER);
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id, status) VALUES (${BYSTANDER}, 'running')`);

        await expect(swapOf(BYSTANDER)).rejects.toMatchObject({
            cause: { message: expect.stringMatching(/append-only/) },
        });
        expect(await countFor(BYSTANDER)).toBe(1);
    });
});
