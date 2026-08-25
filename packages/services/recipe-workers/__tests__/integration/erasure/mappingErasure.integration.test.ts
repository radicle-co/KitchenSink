/**
 * U14 — RIGHT TO ERASURE OVER THE RESOLUTION KNOWLEDGE BASE, against the real schema (plan U10 → U14).
 *
 * ## Why this tier, and why the unit suite next door is not enough
 *
 * `accountErasureWorker.test.ts` pins the SQL the sweep emits. Every claim below is a claim the emitted SQL
 * cannot make on its own, because each one depends on constraints and foreign keys that only PostgreSQL
 * enforces:
 *
 *  1. **That the statement is legal at all.** `author_id` and `source_phrase` must be NULLABLE for the sweep
 *     to run — migration 0021 made them so precisely for this, and a `NOT NULL` on either turns right-to-
 *     erasure into a `23502` on a legal request. A fake db would happily accept the statement either way.
 *  2. ⛔ **That retiring the author's row does NOT destroy the corroboration binding it produced.** This is
 *     the whole reason the sweep is an `UPDATE` and not a `DELETE`: `corroborated_a`/`corroborated_b` are
 *     self-FKs, so a delete would either throw or (had the FK been relaxed) silently un-resolve an
 *     ingredient for every OTHER user of the installation. Only real FKs can prove the chosen shape avoids
 *     both.
 *  3. **That `ingredient_resolution_mappings_supersession_coherent` admits a retirement with NO successor.**
 *     Erasure sets `superseded_at` while leaving `superseded_by` NULL, and the constraint was written to
 *     permit exactly that asymmetry. If it had been written the obvious way (`superseded_at IS NULL =
 *     superseded_by IS NULL`) the sweep would be rejected by the database.
 *  4. **That the partial unique index releases the erased author's slot.**
 *     `idx_resolution_mappings_live_author` is partial on `superseded_at IS NULL AND author_id IS NOT NULL`,
 *     so a retired, de-identified row must stop occupying the `(normalized_key, author_id)` slot — otherwise
 *     an erased-and-returning user could never correct that phrase again.
 *  5. **That another author's live mapping is untouched.** Scope is a `WHERE` clause, and a `WHERE` clause is
 *     only as good as the rows it runs against.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** The author being erased. */
const OWNER_ERASED = '01JU14MAPERASE00OWNERA0000A';

/** A bystander author whose own correction MUST survive, identifiers intact. */
const OWNER_BYSTANDER = '01JU14MAPERASE00OWNERB0000B';

/** The phrase both authors corrected — the key their agreement is counted on. */
const KEY = 'u14 erasure probe plain flour';

/** The food both corrections point at. */
const FOOD_ID = '01JU14MAPERASEFOOD000000001';

/** One `ingredient_resolution_mappings` row, as this suite reads it back. */
type MappingRow = {
    readonly id: string;
    readonly author_id: string | null;
    readonly source_phrase: string | null;
    readonly superseded_at: Date | null;
    readonly superseded_by: string | null;
    readonly origin: string;
    readonly corroborated_a: string | null;
    readonly corroborated_b: string | null;
};

describe.skipIf(!canRun)('erasure over the curated mapping knowledge base (U14 integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        // Citations first: a corroboration row references the two author rows, so it must go before them.
        await db.execute(sql`DELETE FROM ingredient_resolution_mappings WHERE normalized_key = ${KEY}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${OWNER_ERASED}, ${OWNER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert one live author-scoped mapping and return its id. */
    async function insertAuthorMapping(authorId: string, phrase: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO ingredient_resolution_mappings
                (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing)
            VALUES (${KEY}, ${phrase}, ${FOOD_ID}, 'author', 'author', ${authorId}, 'recipe-line')
            RETURNING id
        `);

        return result.rows[0]?.id ?? '';
    }

    /**
     * Insert the corroboration binding citing both author rows, and return its id.
     *
     * ⛔ `source_phrase` is NULL, exactly as `promoteByCorroboration` now writes it. This fixture used to
     * carry a phrase, which is the defect migration 0031 closed: the binding has no `author_id`, so a phrase
     * on it is unreachable by the sweep's predicate and outlives the erasure that should have removed it.
     * The database now refuses the old shape, and `corroborationPhraseErasure.integration.test.ts` next door
     * is where that refusal and the erasure outcome are asserted.
     */
    async function insertCorroboration(a: string, b: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO ingredient_resolution_mappings
                (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing,
                 corroborated_a, corroborated_b)
            VALUES (${KEY}, NULL, ${FOOD_ID}, 'global', 'corroboration', NULL, 'recipe-line',
                    ${a}, ${b})
            RETURNING id
        `);

        return result.rows[0]?.id ?? '';
    }

    /** Read one mapping row by id. */
    async function readMapping(id: string): Promise<MappingRow | undefined> {
        const result = await db.execute<MappingRow>(
            sql`SELECT id, author_id, source_phrase, superseded_at, superseded_by, origin,
                       corroborated_a, corroborated_b
                  FROM ingredient_resolution_mappings WHERE id = ${id}`,
        );

        return result.rows[0];
    }

    it('retires the erased author’s mapping and strips BOTH identifying columns', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, 'plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readMapping(erasedRow);

        expect(after).toBeDefined();
        expect(after?.author_id).toBeNull();
        // ⛔ The typed phrase is the other half of the personal data. A sweep that retired the row and left
        // this behind would have moved the data, not removed it.
        expect(after?.source_phrase).toBeNull();
        expect(after?.superseded_at).not.toBeNull();
    });

    it('⛔ leaves `superseded_by` NULL — a retirement with no successor, which the CHECK must admit', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, 'plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        // `ingredient_resolution_mappings_supersession_coherent` is `superseded_by IS NULL OR superseded_at
        // IS NOT NULL` — one-directional on purpose. The statement above would be REJECTED by the obvious
        // symmetric spelling of that constraint, so this asserts the migration's asymmetry is real.
        expect((await readMapping(erasedRow))?.superseded_by).toBeNull();
    });

    it('⛔ KEEPS the corroboration binding the erased author helped produce, citation intact', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, 'plain flour, sifted');
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, 'plain flour');
        const binding = await insertCorroboration(erasedRow, bystanderRow);

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readMapping(binding);

        // The binding is what every OTHER user's ingredient now resolves through. A hard delete of the
        // erased author's row would have taken it — or the FK — with it.
        expect(after).toBeDefined();
        expect(after?.superseded_at).toBeNull();
        expect(after?.corroborated_a).toBe(erasedRow);
        expect(after?.corroborated_b).toBe(bystanderRow);
        // …and the binding itself never carried an author, so there is nothing on it to strip — which since
        // migration 0031 includes the phrase: it copies nobody's words, so both columns are NULL from birth.
        expect(after?.author_id).toBeNull();
        expect(after?.source_phrase).toBeNull();
    });

    it('does NOT touch another author’s live mapping', async () => {
        await insertAuthorMapping(OWNER_ERASED, 'plain flour, sifted');
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, 'plain flour');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readMapping(bystanderRow);

        expect(after?.author_id).toBe(OWNER_BYSTANDER);
        expect(after?.source_phrase).toBe('plain flour');
        expect(after?.superseded_at).toBeNull();
    });

    it('releases the partial unique slot, so an erased author is not barred from the phrase forever', async () => {
        await insertAuthorMapping(OWNER_ERASED, 'plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        // `idx_resolution_mappings_live_author` is partial on `superseded_at IS NULL AND author_id IS NOT
        // NULL`. If it were not, this insert would collide with the retired row and a returning user could
        // never correct that phrase again — a permanent consequence of exercising a right.
        await expect(insertAuthorMapping(OWNER_ERASED, 'plain flour again')).resolves.not.toBe('');
    });

    it('is idempotent — a redelivered erasure re-runs the sweep and changes nothing further', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, 'plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const first = await readMapping(erasedRow);

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const second = await readMapping(erasedRow);

        // Scoped to `superseded_at IS NULL`, so the second pass matches nothing and the retirement TIMESTAMP
        // does not drift. A sweep that re-stamped it would move the record of when the data was removed.
        expect(second?.superseded_at).toEqual(first?.superseded_at);
        expect(second?.author_id).toBeNull();
    });
});
