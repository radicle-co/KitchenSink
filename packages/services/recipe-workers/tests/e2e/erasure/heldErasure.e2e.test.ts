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

    /**
     * A published recipe of the cook, `held` by cook-captured book evidence. A curator recipe is `imported_public`, no kind.
     * A PRIVATE recipe is what the donate-flip acts on: elected and readable it ends public, elected and held it is removed.
     */
    async function insertRecipe(opts: {
        held: boolean;
        visibility?: 'public' | 'private';
        sourceType?: string;
        sourceKind?: string;
        correctionHold?: boolean;
    }): Promise<string> {
        const { held, visibility = 'public', sourceType = 'user_created', sourceKind, correctionHold = false } = opts;

        return db.transaction(async (tx) => {
            const { rows } = await tx.execute<{ id: string }>(sql`
                INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                     total_time_minutes, visibility, status, source_type, source_kind, statement_kind, source_correction_hold)
                VALUES (${COOK}, 'held erasure probe', 'probe', 2, 5, 5, 10, ${visibility}, 'published', ${sourceType}, ${sourceKind ?? null}, ${sourceKind === undefined ? null : 'source'}, ${correctionHold})
                RETURNING id
            `);
            const id = rows[0]?.id;

            if (typeof id !== 'string') {
                throw new Error('test setup: the recipe insert returned no id');
            }

            if (sourceKind !== undefined) {
                // The stated source needs an evidence row to commit; a staff-capture row is ignored by the read rule's evidence
                // term, so the label alone holds the recipe.
                await tx.execute(sql`
                    INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                    VALUES (${id}, 'staffCorrection', ${sourceKind}, 'A Cookbook, p. 3')
                `);
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
        const heldElected = await insertRecipe({ held: true });
        const heldNotElected = await insertRecipe({ held: true });
        const readableElected = await insertRecipe({ held: false });
        const readableKept = await insertRecipe({ held: false });
        const curator = await insertRecipe({ held: false, sourceType: 'imported_public' });

        await erase([heldElected, readableElected]);

        expect(await survivor(heldElected)).toBeUndefined();
        expect(await survivor(heldNotElected)).toBeUndefined();
        expect(await survivor(readableElected)).toEqual({ visibility: 'public' });
        expect(await survivor(readableKept)).toEqual({ visibility: 'public' });
        expect(await survivor(curator)).toEqual({ visibility: 'public' });
    });

    it('a private recipe: readable and elected is donated, held is removed, not elected is removed', async () => {
        const privateReadableElected = await insertRecipe({ held: false, visibility: 'private' });
        const privateHeldElected = await insertRecipe({ held: true, visibility: 'private' });
        const privateReadableNotElected = await insertRecipe({ held: false, visibility: 'private' });
        // No CHECK backstops the flip (migration 0099): a flip that forgot the held term makes this recipe PUBLIC, and the
        // survivor assertions below fail on it.
        const privateCorrectionHeldElected = await insertRecipe({
            held: false,
            visibility: 'private',
            correctionHold: true,
        });

        await erase([privateReadableElected, privateHeldElected, privateCorrectionHeldElected]);

        expect(await survivor(privateReadableElected)).toEqual({ visibility: 'public' });
        expect(await survivor(privateHeldElected)).toBeUndefined();
        expect(await survivor(privateCorrectionHeldElected)).toBeUndefined();
        expect(await survivor(privateReadableNotElected)).toBeUndefined();
    });

    it('removes a PUBLIC correction-held recipe, elected or not: the hold alone hides it (no CHECK, migration 0099)', async () => {
        const heldElected = await insertRecipe({ held: false, correctionHold: true });
        const heldNotElected = await insertRecipe({ held: false, correctionHold: true });
        const readable = await insertRecipe({ held: false });

        await erase([heldElected, readable]);

        expect(await survivor(heldElected)).toBeUndefined();
        expect(await survivor(heldNotElected)).toBeUndefined();
        expect(await survivor(readable)).toEqual({ visibility: 'public' });
    });

    it.each([
        ['a correction hold', { held: false, correctionHold: true }],
        ['cook evidence', { held: true }],
        ['a private-only label', { held: false, sourceType: 'imported_physical', sourceKind: 'book' }],
    ] as const)('never leaves a recipe held by %s public, whatever its visibility or election', async (_name, held) => {
        const privateElected = await insertRecipe({ ...held, visibility: 'private' });
        const publicElected = await insertRecipe({ ...held, visibility: 'public' });
        const control = await insertRecipe({ held: false, visibility: 'private' });

        await erase([privateElected, publicElected, control]);

        expect(await survivor(privateElected)).toBeUndefined();
        expect(await survivor(publicElected)).toBeUndefined();
        // Control: the same election donates a readable recipe, so the removals above are the hold.
        expect(await survivor(control)).toEqual({ visibility: 'public' });

        const { rows } = await db.execute<{ n: string }>(
            sql`SELECT count(*) AS n FROM recipes WHERE owner_id = ${COOK} AND id IN (${privateElected}, ${publicElected})`,
        );

        expect(Number(rows[0]?.n)).toBe(0);
    });
});
