/**
 * 004 FR-022 — account erasure and the test-principal purge both DELETE the import allowance ledger, against a REAL
 * Postgres (migration 0058).
 *
 * A unit test over the emitted SQL cannot prove what the database does with it: that the statement runs as
 * `recipe_app` (DML only, ADR-0039) with no GRANT written for the new table, that it matches the ledger's real column
 * names, and that a bystander's rows are untouched. Those are observable only here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows, purgeTestPrincipalRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const USER_ERASED = '01JIMPORTALLOWANCEERASED0A';
const USER_BYSTANDER = '01JIMPORTALLOWANCEBYSTAND0';

describe('import allowance ledger — erasure and purge (LOCAL e2e)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM import_allowance_events WHERE user_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seed(): Promise<void> {
        await db.execute(sql`
            INSERT INTO import_allowance_events (user_id, channel, units)
            VALUES (${USER_ERASED}, 'paste', 1), (${USER_ERASED}, 'migration', 1), (${USER_BYSTANDER}, 'paste', 1)
        `);
    }

    async function unitsOf(userId: string): Promise<number> {
        const result = await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM import_allowance_events WHERE user_id = ${userId}`,
        );

        return result.rows[0]?.n ?? 0;
    }

    it('⛔ account erasure deletes every ledger row of the erased user and none of a bystander', async () => {
        await seed();

        await eraseRecipeRows(db, USER_ERASED, []);

        expect(await unitsOf(USER_ERASED)).toBe(0);
        expect(await unitsOf(USER_BYSTANDER)).toBe(1);
    });

    it('⛔ the test-principal purge deletes the ledger too, so a reset principal starts with a full allowance', async () => {
        await seed();

        await purgeTestPrincipalRows(db, USER_ERASED);

        expect(await unitsOf(USER_ERASED)).toBe(0);
        expect(await unitsOf(USER_BYSTANDER)).toBe(1);
    });
});
