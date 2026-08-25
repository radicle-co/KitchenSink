/**
 * A TYPED PHRASE IS NEVER STORED WITHOUT AN OWNER TO ATTRIBUTE IT TO (plan U10 → U14, migration 0031).
 *
 * ## The defect this suite exists for
 *
 * `promoteByCorroboration` used to copy `request.sourcePhrase` — **the requesting cook's own typed words** —
 * onto the `corroboration` binding it inserts, with `author_id` a literal `NULL`. The account-erasure sweep
 * reaches that table by `WHERE author_id = $owner`, so the copy was **structurally unreachable**: when both
 * authors whose agreement produced the binding exercised their right to erasure, their own rows were
 * de-identified and this third row kept one of their phrases forever. Nothing failed, nothing could — the
 * table IS swept, just not that row.
 *
 * ⛔ Retiring or deleting the binding is the wrong repair, and the schema says why: it is a `global`-scope
 * row every OTHER user of the installation now resolves through, and it CITES the two author rows
 * (`corroborated_a`/`corroborated_b`, a self-FK). The repair is to store no phrase in the first place.
 *
 * ## Why nulling at INSERT rather than sweeping later
 *
 * The phrase on a corroboration row is a COPY with no purpose of its own. Its documented job — migration
 * 0021's "two-way door", so a change to `normalizedIngredientKey` is repaired by
 * `UPDATE … SET normalized_key = f(source_phrase)` rather than by data loss — is already served by the two
 * rows it cites, each of which carries its own phrase. A backfill for the binding runs through
 * `corroborated_a`, and when BOTH citations have been erased their phrases are NULL anyway, so the binding's
 * repairability is exactly the weaker of its two citations either way. A later sweep, by contrast, would
 * have to key on a column the binding does not have, would leave the data present for the whole unbounded
 * interval between promotion and erasure, and could not even say WHICH of the two authors typed it.
 *
 * ## Why this tier
 *
 * Every claim below is one a mocked DAL test cannot make: that the statement the DAL emits stores no phrase,
 * and that PostgreSQL now REFUSES the row shape the old statement produced. The second is the load-bearing
 * half — a comment saying "don't store a phrase here" is a convention, a CHECK constraint is a fact.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    normalizedIngredientKey,
    type NormalizedIngredientKey,
} from '@kitchensink/recipe-core/resolution/normalized-key';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { evaluateMappingWrite } from '../../../src/ingredients/domain/mappingScopePolicy.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const FOOD_A = '01JU31PHRASE000000000FOODA0';
const AUTHOR_A = '01JU31PHRASE00000000AUTHA00';
const AUTHOR_B = '01JU31PHRASE00000000AUTHB00';

/** Every key this suite writes shares this prefix, so cleanup is exact and collides with no other spec. */
const PREFIX = 'u31 phrase';

/**
 * The two cooks type the SAME ingredient DIFFERENTLY — which is the ordinary case, and the reason the copied
 * phrase is one identifiable person's data rather than a neutral fact about the binding.
 *
 * ⚠️ They must differ in the raw text and AGREE on the derived key, or no promotion happens and the suite
 * would assert about a binding that was never created. `normalizedIngredientKey` is NFKC + invisible-strip +
 * whitespace-collapse + trim + lowercase (`sanitizeFoodName`), so case and spacing are exactly the axes that
 * survive as raw text and vanish from the key.
 */
const PHRASE_A = `${PREFIX} Plain Flour`;
const PHRASE_B = `${PREFIX}   plain    FLOUR  `;

/** One `ingredient_resolution_mappings` row, as this suite reads it back. */
interface MappingRow {
    readonly id: string;
    readonly origin: string;
    readonly author_id: string | null;
    readonly source_phrase: string | null;
}

/** Build a key inside this suite's namespace. Throws on an unusable phrase — a setup error, not a case. */
function key(phrase: string): NormalizedIngredientKey {
    const built = normalizedIngredientKey(phrase);

    if (built === undefined) {
        throw new Error(`test setup: "${phrase}" produced no key`);
    }

    return built;
}

describe.skipIf(!hasDatabaseUrl)('a stored phrase always has an owner (U10 → U14)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: ResolutionMappingsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new ResolutionMappingsDal(db);
    });

    afterEach(async () => {
        // Citations first: a corroboration row references the two author rows, so it must go before them.
        await pool.query(
            `DELETE FROM ingredient_resolution_mappings
             WHERE normalized_key LIKE $1 AND origin = 'corroboration'`,
            [`${PREFIX}%`],
        );
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Write one correction end to end, the shape the service uses: read the facts, decide, apply. */
    async function correct(rawPhrase: string, authorId: string): ReturnType<ResolutionMappingsDal['applyWrite']> {
        const k = key(rawPhrase);
        const facts = await dal.findWriteFacts(k, authorId, FOOD_A);
        const decision = evaluateMappingWrite({ correctedFoodId: FOOD_A, grantedScopes: [], ...facts });

        return dal.applyWrite({
            decision,
            normalizedKey: k,
            sourcePhrase: rawPhrase,
            foodId: FOOD_A,
            authorId,
            surfacing: 'picker_correction',
        });
    }

    /** Every mapping row this suite's two cooks produced, in a stable order. */
    async function mappingsForKey(): Promise<readonly MappingRow[]> {
        const { rows } = await pool.query<MappingRow>(
            `SELECT id, origin, author_id, source_phrase
               FROM ingredient_resolution_mappings
              WHERE normalized_key = $1
              ORDER BY origin, created_at`,
            [key(PHRASE_A)],
        );

        return rows;
    }

    it('⛔ stores NO typed phrase on the corroboration binding two authors earn', async () => {
        await correct(PHRASE_A, AUTHOR_A);
        const promoted = await correct(PHRASE_B, AUTHOR_B);

        // Precondition: the two corrections really did agree, so a binding exists to make a claim about.
        expect(promoted.written && promoted.promotion).toBeDefined();

        const rows = await mappingsForKey();
        const binding = rows.find((row) => row.origin === 'corroboration');

        expect(binding).toBeDefined();
        // ⛔ THE DEFECT. Before migration 0031 this held `PHRASE_B` — the promoting cook's own wording — on a
        // row with no `author_id`, which is the one column the erasure sweep's predicate keys on. The phrase
        // therefore survived that cook's erasure permanently, on a row nobody could point erasure at.
        expect(binding?.source_phrase).toBeNull();
        expect(binding?.author_id).toBeNull();
    });

    it('⛔ leaves NO row at all carrying a phrase with no owner beside it', async () => {
        await correct(PHRASE_A, AUTHOR_A);
        await correct(PHRASE_B, AUTHOR_B);

        const orphaned = (await mappingsForKey()).filter((row) => row.author_id === null && row.source_phrase !== null);

        // Stated as the INVARIANT rather than as a fact about the corroboration row, because the invariant is
        // what the sweep depends on: a row whose owner column is NULL is unreachable by `WHERE author_id =
        // $owner`, whatever produced it.
        expect(orphaned).toEqual([]);
    });

    it('keeps BOTH authors’ own phrases, verbatim — de-identification is not the same as forgetting', async () => {
        await correct(PHRASE_A, AUTHOR_A);
        await correct(PHRASE_B, AUTHOR_B);

        const authored = (await mappingsForKey()).filter((row) => row.origin === 'author');

        // The two-way door 0021 keeps is on the AUTHOR rows, and it must not be collateral damage of the fix
        // above: each cook's raw wording still sits beside their own id, where erasure can reach it.
        expect(authored.map((row) => [row.author_id, row.source_phrase]).sort()).toEqual(
            [
                [AUTHOR_A, PHRASE_A],
                [AUTHOR_B, PHRASE_B],
            ].sort(),
        );
    });

    it('⛔ REFUSES a mapping row that carries a phrase with no author — the shape the promotion used to write', async () => {
        const rowA = await correct(PHRASE_A, AUTHOR_A);
        const rowB = await correct(PHRASE_B, AUTHOR_B);
        const [first, second] = [
            (rowA.written && rowA.mappingId) as string,
            (rowB.written && rowB.mappingId) as string,
        ].sort();

        // The pre-0031 statement, verbatim apart from the pair it cites. A comment telling the next writer
        // not to store a phrase here is a convention; a constraint that rejects the row is a fact, and it is
        // what stops this being re-introduced by a writer who never reads this file.
        await expect(
            pool.query(
                `INSERT INTO ingredient_resolution_mappings
                     (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing,
                      corroborated_a, corroborated_b)
                 VALUES ($1, $2, $3, 'global', 'corroboration', NULL, 'corroboration', $4, $5)`,
                [key(PHRASE_A), PHRASE_B, FOOD_A, first, second],
            ),
        ).rejects.toMatchObject({ code: '23514', constraint: 'ingredient_resolution_mappings_phrase_needs_owner' });
    });

    it('⛔ REFUSES a memo whose phrase has no owner — the same rule, one tier down', async () => {
        // `recordMemo` used to insert `source_phrase` with no `owner_id` column in the statement at all, so
        // every memo it wrote was invisible to the sweep's `WHERE owner_id = $owner`. Same defect, same
        // repair: the phrase and the person move together or the row is refused.
        await expect(
            pool.query(
                `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
                 VALUES ($1, $2, $3, 'test-model-v1')`,
                [key(PHRASE_A), FOOD_A, PHRASE_A],
            ),
        ).rejects.toMatchObject({ code: '23514', constraint: 'ingredient_resolution_memos_phrase_needs_owner' });
    });

    it('records the memo owner beside the phrase, so the sweep’s predicate reaches it', async () => {
        await dal.recordMemo({
            normalizedKey: key(PHRASE_A),
            foodId: FOOD_A,
            sourcePhrase: PHRASE_A,
            verifiedBy: 'test-model-v1',
            ownerId: AUTHOR_A,
        });

        const { rows } = await pool.query<{ owner_id: string | null; source_phrase: string | null }>(
            'SELECT owner_id, source_phrase FROM ingredient_resolution_memos WHERE normalized_key = $1',
            [key(PHRASE_A)],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.owner_id).toBe(AUTHOR_A);
        expect(rows[0]?.source_phrase).toBe(PHRASE_A);
    });

    it('⛔ moves the memo’s owner with its phrase on re-verification by a DIFFERENT cook', async () => {
        await dal.recordMemo({
            normalizedKey: key(PHRASE_A),
            foodId: FOOD_A,
            sourcePhrase: PHRASE_A,
            verifiedBy: 'test-model-v1',
            ownerId: AUTHOR_A,
        });
        await dal.recordMemo({
            normalizedKey: key(PHRASE_A),
            foodId: FOOD_A,
            sourcePhrase: PHRASE_B,
            verifiedBy: 'test-model-v2',
            ownerId: AUTHOR_B,
        });

        const { rows } = await pool.query<{ owner_id: string | null; source_phrase: string | null }>(
            'SELECT owner_id, source_phrase FROM ingredient_resolution_memos WHERE normalized_key = $1',
            [key(PHRASE_A)],
        );

        // The table is keyed on the phrase's normalized form, so two cooks share ONE row. An upsert that
        // replaced the phrase and left the previous owner's id beside it would aim the NEXT erasure at the
        // wrong person: it would sweep a phrase that cook never typed and leave the one they did.
        expect(rows[0]?.owner_id).toBe(AUTHOR_B);
        expect(rows[0]?.source_phrase).toBe(PHRASE_B);
    });
});
