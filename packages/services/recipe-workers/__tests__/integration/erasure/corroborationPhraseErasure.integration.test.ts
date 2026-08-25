/**
 * U14 — THE ROW THE ERASURE SWEEP COULD NOT REACH, against the real schema (plan U10 → U14, migration 0031).
 *
 * ## The defect, stated as the sweep sees it
 *
 * `eraseRecipeRows` de-identifies `ingredient_resolution_mappings` with
 * `SET author_id = NULL, source_phrase = NULL WHERE author_id = $owner`. `promoteByCorroboration` inserted a
 * `corroboration` binding carrying `author_id = NULL` **and a copy of the promoting cook's typed phrase** —
 * so that row was STRUCTURALLY unreachable by the only predicate that de-identifies the table. Two cooks
 * agree, both later exercise their right to erasure, both of their own rows are scrubbed, and a third row
 * keeps one of their phrases forever. Nothing failed and nothing could: the table IS swept, and
 * `erasureSweepCoverage.test.ts` — which reasons per TABLE — reported it covered.
 *
 * ⛔ THE OBVIOUS REPAIRS ARE BOTH WRONG, and the sibling suites next door say why.
 *  * A DELETE breaks the binding's self-FK citations (`corroborated_a`/`corroborated_b`) or, had the FK been
 *    relaxed, silently un-resolves the ingredient for every OTHER user of the installation.
 *  * Stamping `superseded_at` is the same harm wearing an `UPDATE`'s clothes: the binding is `global` scope,
 *    so retiring it withdraws a resolution from the whole installation the moment ONE of its two authors
 *    exercises a PERSONAL right. `parseCorrectionErasure.integration.test.ts` reaches the identical
 *    conclusion for U21's tier, which is the sibling that made the shape here obvious.
 *
 * The repair is upstream: the binding stores no phrase, and 0031's CHECK makes a row that carries one
 * unrepresentable. This suite asserts the OUTCOME — nothing carrying the erased cook's words survives — so
 * it holds whether the phrase was never written or reached by something later.
 *
 * ## Why this tier, and why the unit suite next door cannot stand in for it
 *
 * `accountErasureWorker.test.ts` pins the SQL the sweep emits. It cannot observe a row the emitted predicate
 * does not match, because a fake db has no rows. Every claim below needs a real PostgreSQL:
 *
 *  1. **That no row anywhere still carries the phrase**, which is a query over the table's actual contents.
 *  2. ⛔ **That the binding SURVIVES, live.** Only real FKs and a real `global`-scope read can show that the
 *     de-identification did not cost a third party their resolution.
 *  3. ⛔ **That the pre-0031 row shape is now REFUSED.** A comment is a convention; a CHECK is a fact, and it
 *     is the only thing that stops a future writer re-introducing the copy without reading any of this.
 *  4. **That another cook's live mapping is untouched.** Scope is a `WHERE` clause, and a `WHERE` clause is
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

/** The cook exercising their right to erasure — and the one whose wording the binding used to copy. */
const OWNER_ERASED = '01JU31CORROBERASE0OWNERA000';

/** The other half of the agreement. Their own correction MUST survive, identifiers intact. */
const OWNER_BYSTANDER = '01JU31CORROBERASE0OWNERB000';

/** The key the two cooks' agreement is counted on. */
const KEY = 'u31 corroboration erasure probe plain flour';

/** The food both corrections point at. */
const FOOD_ID = '01JU31CORROBERASEFOOD000001';

/**
 * The erased cook's exact wording. The binding used to carry THIS string, on a row with no `author_id`, so
 * this is the value whose survival is the defect — asserted by name rather than by a row count.
 */
const PHRASE_ERASED = 'u31 corroboration erasure probe Plain Flour, sifted twice';

/** The bystander's wording — different words, same key, which is the ordinary case. */
const PHRASE_BYSTANDER = 'u31 corroboration erasure probe plain flour';

/**
 * One `ingredient_resolution_mappings` row, as this suite reads it back.
 *
 * ⚠️ A type ALIAS, not an interface, and the sibling suite next door is the same. Drizzle's `execute<T>`
 * constrains `T` to `Record<string, unknown>`, which an interface does not satisfy — TypeScript gives an
 * implicit index signature to object type aliases only.
 */
type MappingRow = {
    readonly id: string;
    readonly author_id: string | null;
    readonly source_phrase: string | null;
    readonly superseded_at: Date | null;
    readonly origin: string;
    readonly food_id: string;
    readonly corroborated_a: string | null;
    readonly corroborated_b: string | null;
};

/** PostgreSQL's CHECK-violation SQLSTATE. */
const CHECK_VIOLATION = '23514';

/**
 * The SQLSTATE a failed statement carries, from anywhere in the error's `cause` chain.
 *
 * ⚠️ Drizzle wraps the driver's error in a `DrizzleQueryError`, so the `code` is on the CAUSE rather than on
 * what is thrown. Reading only the top-level property silently finds nothing, which would turn the fallback
 * below into a rethrow and this suite into a false failure.
 *
 * @param error - Whatever was thrown.
 * @returns The SQLSTATE, or `undefined` when the error carries none. Pure.
 */
function sqlStateOf(error: unknown): string | undefined {
    for (
        let current = error;
        current !== null && current !== undefined;
        current = (current as { cause?: unknown }).cause
    ) {
        const code = (current as { code?: unknown }).code;

        if (typeof code === 'string') {
            return code;
        }
    }

    return undefined;
}

describe.skipIf(!canRun)('erasure over a corroboration binding (U14 integration)', () => {
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
            VALUES (${KEY}, ${phrase}, ${FOOD_ID}, 'author', 'author', ${authorId}, 'picker_correction')
            RETURNING id
        `);

        return result.rows[0]?.id ?? '';
    }

    /**
     * Insert the corroboration binding, ATTEMPTING the phrase the pre-0031 promotion copied onto it.
     *
     * ⚠️ The fallback is deliberate and is what keeps this suite honest across the fix. The claim under test
     * is about what survives ERASURE, and it has to hold in both worlds: the row is created carrying the
     * phrase where the database still accepts one (the defect's world, where the assertion below then fails
     * NAMING the surviving phrase), and carrying none where 0031's CHECK refuses it. Hard-coding either
     * shape would make this a test of the fixture instead of a test of the outcome.
     *
     * @param a - First cited author mapping.
     * @param b - Second cited author mapping.
     * @param phrase - The phrase the old promotion would have copied here.
     * @returns The binding's row id.
     * @sideEffect Inserts into `ingredient_resolution_mappings`.
     */
    async function insertCorroborationAsPromotionUsedTo(a: string, b: string, phrase: string): Promise<string> {
        const insert = async (carried: string | null): Promise<string> => {
            const result = await db.execute<{ id: string }>(sql`
                INSERT INTO ingredient_resolution_mappings
                    (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing,
                     corroborated_a, corroborated_b)
                VALUES (${KEY}, ${carried}, ${FOOD_ID}, 'global', 'corroboration', NULL, 'corroboration',
                        ${a}, ${b})
                RETURNING id
            `);

            return result.rows[0]?.id ?? '';
        };

        try {
            return await insert(phrase);
        } catch (error) {
            if (sqlStateOf(error) !== CHECK_VIOLATION) {
                throw error;
            }

            return insert(null);
        }
    }

    /** Every mapping row anywhere in the table that still carries `phrase`. */
    async function rowsCarrying(phrase: string): Promise<readonly MappingRow[]> {
        const result = await db.execute<MappingRow>(sql`
            SELECT id, author_id, source_phrase, superseded_at, origin, food_id, corroborated_a, corroborated_b
              FROM ingredient_resolution_mappings
             WHERE source_phrase = ${phrase}
        `);

        return result.rows;
    }

    /** Read one mapping row by id. */
    async function readMapping(id: string): Promise<MappingRow | undefined> {
        const result = await db.execute<MappingRow>(sql`
            SELECT id, author_id, source_phrase, superseded_at, origin, food_id, corroborated_a, corroborated_b
              FROM ingredient_resolution_mappings WHERE id = ${id}
        `);

        return result.rows[0];
    }

    it('⛔ leaves NO row anywhere still carrying the erased cook’s typed phrase', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, PHRASE_ERASED);
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, PHRASE_BYSTANDER);

        await insertCorroborationAsPromotionUsedTo(erasedRow, bystanderRow, PHRASE_ERASED);
        await eraseRecipeRows(db, OWNER_ERASED, []);

        // ⛔ THE DEFECT, stated as the right the sweep exists to honour. Before 0031 this returned the
        // `corroboration` row: `author_id = NULL`, so `WHERE author_id = $owner` never matched it, so the
        // cook's own words outlived their erasure with nothing to point erasure AT.
        expect(await rowsCarrying(PHRASE_ERASED)).toEqual([]);
    });

    it('⛔ KEEPS the binding LIVE, so a third user still resolves the ingredient', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, PHRASE_ERASED);
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, PHRASE_BYSTANDER);
        const binding = await insertCorroborationAsPromotionUsedTo(erasedRow, bystanderRow, PHRASE_ERASED);

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readMapping(binding);

        // The other half of the ruling: de-identifying must not cost a third party their resolution. The
        // binding is the row every OTHER user's cascade reads through, and both a DELETE and a
        // `superseded_at` stamp would have taken it away over ONE person's personal right.
        expect(after?.superseded_at).toBeNull();
        expect(after?.food_id).toBe(FOOD_ID);
        expect(after?.corroborated_a).toBe(erasedRow);
        expect(after?.corroborated_b).toBe(bystanderRow);

        // …and the tier-1 read a third user runs — the live global mapping for this key — still answers.
        const live = await db.execute<{ food_id: string }>(sql`
            SELECT food_id FROM ingredient_resolution_mappings
             WHERE normalized_key = ${KEY} AND scope = 'global' AND superseded_at IS NULL
        `);

        expect(live.rows.map((row) => row.food_id)).toEqual([FOOD_ID]);
    });

    it('⛔ REFUSES a binding that carries a phrase with no author to attribute it to', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, PHRASE_ERASED);
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, PHRASE_BYSTANDER);

        // The pre-0031 promotion statement, verbatim. The sweep cannot grow a predicate for a row with no
        // owner column set, so the invariant has to be enforced where the row is CREATED — by the database,
        // not by a convention the next writer has to have read.
        await expect(
            db.execute(sql`
                INSERT INTO ingredient_resolution_mappings
                    (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing,
                     corroborated_a, corroborated_b)
                VALUES (${KEY}, ${PHRASE_ERASED}, ${FOOD_ID}, 'global', 'corroboration', NULL, 'corroboration',
                        ${erasedRow}, ${bystanderRow})
            `),
        ).rejects.toSatisfy(
            (error: unknown) => sqlStateOf(error) === CHECK_VIOLATION,
            `a CHECK violation (${CHECK_VIOLATION}) — the binding must not be able to hold a phrase`,
        );
    });

    it('does NOT touch the bystander’s live mapping', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, PHRASE_ERASED);
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, PHRASE_BYSTANDER);

        await insertCorroborationAsPromotionUsedTo(erasedRow, bystanderRow, PHRASE_ERASED);
        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readMapping(bystanderRow);

        // One cook's erasure is not the other's. Their id and their wording both stand.
        expect(after?.author_id).toBe(OWNER_BYSTANDER);
        expect(after?.source_phrase).toBe(PHRASE_BYSTANDER);
        expect(after?.superseded_at).toBeNull();
    });

    it('retires and de-identifies the erased cook’s OWN row, both columns together', async () => {
        const erasedRow = await insertAuthorMapping(OWNER_ERASED, PHRASE_ERASED);
        const bystanderRow = await insertAuthorMapping(OWNER_BYSTANDER, PHRASE_BYSTANDER);

        await insertCorroborationAsPromotionUsedTo(erasedRow, bystanderRow, PHRASE_ERASED);
        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readMapping(erasedRow);

        // 0031's CHECK is `(author_id IS NULL) = (source_phrase IS NULL)`, so a sweep that cleared only one
        // of the two would be REJECTED by the database rather than quietly leaving half the personal data —
        // or, worse, leaving an id beside somebody else's words and aiming the NEXT erasure at them.
        expect(after?.author_id).toBeNull();
        expect(after?.source_phrase).toBeNull();
        expect(after?.superseded_at).not.toBeNull();
    });
});
