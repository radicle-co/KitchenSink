/**
 * ACCOUNT ERASURE LEAVES THE INGREDIENT KNOWLEDGE BASE ALONE (owner ruling 2026-08-25, ADR-0027).
 *
 * ## What this suite replaces
 *
 * It stands where three suites stood — `mappingErasure`, `corroborationPhraseErasure` and
 * `parseCorrectionErasure` — and asserts the INVERSE of all three. Each of those proved that
 * `eraseRecipeRows` de-identified one of the ingredient tiers: nulling a person column and the phrase or line
 * beside it. The owner ruled that **an ingredient phrase — the original a cook typed, or a corrected one — is
 * not private data.** It does not need to be erasable, no sweep targets it, and migration 0033 removed the
 * three statements along with the memo tier's person column and the two CHECKs that had tied phrase to
 * person.
 *
 * ## ⛔ Why this tier, and why the unit assertion next door is not enough
 *
 * `accountErasureWorker.test.ts` reads the SQL the sweep EMITS, over a `FakeDb`. That proves the statements
 * are absent from the source; it cannot prove the rows are untouched. Three things only a real database can
 * answer, and each is a way the ruling could be honoured in the source and broken in fact:
 *
 *  1. **A cascade or a trigger could reach these rows without a statement naming the table.** The erasure
 *     transaction deletes from `recipes` and `collections`, and this database is full of FKs and one
 *     statement-level trigger. Reading the row back AFTER a real erasure is the only check that covers a path
 *     nobody wrote down.
 *  2. **The row must survive the erasure with its `user_id` INTACT** — not merely un-nulled in the source.
 *     That id is the distinct-user corroboration counter; if anything cleared it, one cook's erasure would
 *     silently dissolve a promotion every other cook resolves through.
 *  3. **The corroboration binding must stay LIVE.** It is a `global`-scope row the whole installation reads,
 *     and it CITES the two author rows. A `superseded_at` stamped on it by any path would withdraw a
 *     resolution from everyone over one person's request.
 *
 * ⚠️ This suite deliberately asserts a NEGATIVE, so every case pins a POSITIVE first — the row exists, and
 * the erasure actually ran — before checking that nothing moved. An assertion that nothing changed is
 * satisfied by a fixture that was never written.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** The cook whose account is erased. */
const USER_ERASED = '01JU33RETAIN000USERERASED0A';

/** A bystander cook whose own correction must also survive untouched. */
const USER_BYSTANDER = '01JU33RETAIN000USERBYSTAND0';

/** The phrase both cooks corrected — the key their agreement is counted on. */
const KEY = 'u33 retained probe plain flour';

/** The food both corrections point at. */
const FOOD_ID = '01JU33RETAINFOOD00000000001';

/** One `ingredient_resolution_mappings` row, as this suite reads it back. */
type MappingRow = {
    readonly id: string;
    readonly user_id: string | null;
    readonly source_phrase: string | null;
    readonly superseded_at: Date | null;
    readonly origin: string;
    readonly corroborated_a: string | null;
    readonly corroborated_b: string | null;
};

/** One `ingredient_parse_corrections` row, as this suite reads it back. */
type CorrectionRow = {
    readonly id: string;
    readonly user_id: string | null;
    readonly source_line: string | null;
    readonly superseded_at: Date | null;
};

/** One `ingredient_resolution_memos` row, as this suite reads it back. */
type MemoRow = {
    readonly source_phrase: string | null;
    readonly verified_by: string;
};

describe.skipIf(!canRun)('account erasure leaves the ingredient tiers alone (ADR-0027)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        // Citations first: a corroboration row references the two author rows, so it must go before them.
        await db.execute(
            sql`DELETE FROM ingredient_resolution_mappings WHERE normalized_key = ${KEY} AND origin = 'corroboration'`,
        );
        await db.execute(sql`DELETE FROM ingredient_resolution_mappings WHERE normalized_key = ${KEY}`);
        await db.execute(sql`DELETE FROM ingredient_parse_corrections WHERE normalized_key = ${KEY}`);
        await db.execute(sql`DELETE FROM ingredient_resolution_memos WHERE normalized_key = ${KEY}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert one live author-scoped mapping and return its id. */
    async function insertMapping(userId: string, phrase: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO ingredient_resolution_mappings
                (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)
            VALUES (${KEY}, ${phrase}, ${FOOD_ID}, 'author', 'author', ${userId}, 'recipe-line')
            RETURNING id
        `);
        const id = result.rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the mapping insert returned no id');
        }

        return id;
    }

    /** Every `ingredient_resolution_mappings` row for this suite's key, in insertion order. */
    async function mappings(): Promise<readonly MappingRow[]> {
        const { rows } = await db.execute<MappingRow>(sql`
            SELECT id, user_id, source_phrase, superseded_at, origin, corroborated_a, corroborated_b
            FROM ingredient_resolution_mappings WHERE normalized_key = ${KEY}
            ORDER BY created_at, id
        `);

        return rows;
    }

    it('⛔ leaves the erased cook’s own curated mapping COMPLETELY untouched', async () => {
        await insertMapping(USER_ERASED, 'Plain Flour');

        const before = await mappings();

        // The positive first: the fixture is really there, so the negative below is about a row that exists.
        expect(before).toHaveLength(1);
        expect(before[0]?.user_id).toBe(USER_ERASED);

        await eraseRecipeRows(db, USER_ERASED, []);

        const after = await mappings();

        expect(after).toHaveLength(1);
        // The user id SURVIVES. It is the distinct-user corroboration counter and the predicate that
        // authorizes supersession — clearing it would un-authorize a cook from their own correction.
        expect(after[0]?.user_id).toBe(USER_ERASED);
        // The phrase survives verbatim: it is not private data, and it is 0021's two-way door.
        expect(after[0]?.source_phrase).toBe('Plain Flour');
        // And the row is not retired. The old sweep stamped `superseded_at` here.
        expect(after[0]?.superseded_at).toBeNull();
    });

    it('⛔ keeps a corroboration binding LIVE, with both citations and both cooks intact', async () => {
        const erasedRow = await insertMapping(USER_ERASED, 'Plain Flour');
        const bystanderRow = await insertMapping(USER_BYSTANDER, 'plain flour');
        const [first, second] = [erasedRow, bystanderRow].sort();

        await db.execute(sql`
            INSERT INTO ingredient_resolution_mappings
                (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing,
                 corroborated_a, corroborated_b)
            VALUES (${KEY}, NULL, ${FOOD_ID}, 'global', 'corroboration', NULL, 'corroboration',
                    ${first}, ${second})
        `);

        expect(await mappings()).toHaveLength(3);

        await eraseRecipeRows(db, USER_ERASED, []);

        const after = await mappings();
        const binding = after.find((row) => row.origin === 'corroboration');

        expect(after).toHaveLength(3);

        // ⚠️ Narrowed rather than optional-chained: `expect(binding?.x)` passes vacuously when the binding is
        // gone, which is the exact failure this case exists to catch.
        if (binding === undefined) {
            throw new Error('the corroboration binding did not survive the erasure');
        }

        expect(binding.superseded_at).toBeNull();
        expect(binding.corroborated_a).toBe(first);
        expect(binding.corroborated_b).toBe(second);
        // Both contributing cooks keep their own rows, so the promotion stays auditable by `SELECT`.
        expect(
            after
                .filter((row) => row.user_id !== null)
                .map((row) => row.user_id)
                .sort(),
        ).toEqual([USER_ERASED, USER_BYSTANDER].sort());
    });

    it('⛔ leaves a parse correction — line, user and all — exactly as it was', async () => {
        await db.execute(sql`
            INSERT INTO ingredient_parse_corrections
                (normalized_key, source_line, corrected_facts, scope, origin, user_id, surfacing)
            VALUES (${KEY}, ${'2 cups plain flour, sifted'}, ${'{"unit":"cup"}'}::jsonb, 'author', 'author',
                    ${USER_ERASED}, 'line-editor')
        `);

        const before = await db.execute<CorrectionRow>(
            sql`SELECT id, user_id, source_line, superseded_at FROM ingredient_parse_corrections WHERE normalized_key = ${KEY}`,
        );

        expect(before.rows).toHaveLength(1);

        await eraseRecipeRows(db, USER_ERASED, []);

        const after = await db.execute<CorrectionRow>(
            sql`SELECT id, user_id, source_line, superseded_at FROM ingredient_parse_corrections WHERE normalized_key = ${KEY}`,
        );

        expect(after.rows).toHaveLength(1);
        expect(after.rows[0]?.user_id).toBe(USER_ERASED);
        expect(after.rows[0]?.source_line).toBe('2 cups plain flour, sifted');
        expect(after.rows[0]?.superseded_at).toBeNull();
    });

    it('⛔ leaves a memo’s phrase in place — the tier has no person to key an erasure on', async () => {
        await db.execute(sql`
            INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
            VALUES (${KEY}, ${FOOD_ID}, ${'Plain Flour'}, ${'test-model'})
        `);

        await eraseRecipeRows(db, USER_ERASED, []);

        const { rows } = await db.execute<MemoRow>(
            sql`SELECT source_phrase, verified_by FROM ingredient_resolution_memos WHERE normalized_key = ${KEY}`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.source_phrase).toBe('Plain Flour');
        expect(rows[0]?.verified_by).toBe('test-model');
    });

    it('proves the erasure it runs is a REAL one — the owner’s recipes really are removed', async () => {
        // ⛔ The non-vacuity floor for this whole suite. Every case above asserts that `eraseRecipeRows` did
        // NOT touch something; all of them would pass against a function that did nothing at all. This one
        // pins that the same call, on the same fixture, really does erase what it is supposed to.
        const recipe = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status)
            VALUES (${USER_ERASED}, 'U33 retained probe', 'probe', 2, 5, 5, 10, 'private', 'published')
            RETURNING id
        `);

        expect(recipe.rows).toHaveLength(1);

        await insertMapping(USER_ERASED, 'Plain Flour');
        const { removedRecipeIds } = await eraseRecipeRows(db, USER_ERASED, []);

        expect(removedRecipeIds).toEqual([recipe.rows[0]?.id]);

        const survivors = await db.execute<{ id: string }>(sql`SELECT id FROM recipes WHERE owner_id = ${USER_ERASED}`);

        expect(survivors.rows).toEqual([]);
        // …and the mapping is STILL there, in the same transaction that really deleted a recipe.
        expect(await mappings()).toHaveLength(1);
    });
});
