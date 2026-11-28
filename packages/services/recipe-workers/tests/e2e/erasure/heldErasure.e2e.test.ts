/**
 * Account erasure and the read rule's hold (ADR-0105), against a REAL Postgres.
 *
 * A recipe the read rule hides from readers (`recipe_held_from_readers`) is never "truly public": erasure REMOVES it, whether or
 * not the cook elected to donate it, and never donates it. A readable public recipe is kept pseudonymized, or donated when
 * elected, as before. The unit tests pin the emitted SQL; only the database decides what the function answers for a row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const COOK = '01JHELDERASURECOOK00000001';

describe('erasure of a recipe held from readers (ADR-0105)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM recipes WHERE owner_id = ${COOK}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id = ${COOK}`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** A published recipe of the cook, `held` by cook-captured book evidence. A curator recipe is `imported_public`, no kind. */
    async function insertPublic(held: boolean, sourceType = 'user_created'): Promise<string> {
        return db.transaction(async (tx) => {
            const { rows } = await tx.execute<{ id: string }>(sql`
                INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                     total_time_minutes, visibility, status, source_type)
                VALUES (${COOK}, 'held erasure probe', 'probe', 2, 5, 5, 10, 'public', 'published', ${sourceType})
                RETURNING id
            `);
            const id = rows[0]?.id;

            if (typeof id !== 'string') {
                throw new Error('test setup: the recipe insert returned no id');
            }

            if (held) {
                await tx.execute(sql`
                    INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                    VALUES (${id}, 'editorCitation', 'book', 'A Cookbook, p. 3')
                `);
            }

            return id;
        });
    }

    async function survivor(id: string): Promise<{ visibility: string } | undefined> {
        const { rows } = await db.execute<{ visibility: string }>(sql`SELECT visibility FROM recipes WHERE id = ${id}`);

        return rows[0];
    }

    async function erase(elected: readonly string[]): Promise<void> {
        await db.execute(sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${COOK}, 'running')`);
        await eraseRecipeRows(db, COOK, elected);
    }

    it('removes a held public recipe whether or not it was elected, and keeps or donates the readable ones', async () => {
        const heldElected = await insertPublic(true);
        const heldNotElected = await insertPublic(true);
        const readableElected = await insertPublic(false);
        const readableKept = await insertPublic(false);
        const curator = await insertPublic(false, 'imported_public');

        await erase([heldElected, readableElected]);

        expect(await survivor(heldElected)).toBeUndefined();
        expect(await survivor(heldNotElected)).toBeUndefined();
        expect(await survivor(readableElected)).toEqual({ visibility: 'public' });
        expect(await survivor(readableKept)).toEqual({ visibility: 'public' });
        expect(await survivor(curator)).toEqual({ visibility: 'public' });
    });
});
