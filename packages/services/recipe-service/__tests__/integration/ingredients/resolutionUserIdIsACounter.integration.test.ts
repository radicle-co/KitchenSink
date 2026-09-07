/**
 * THE USER ID ON A CORRECTION IS A COUNTER, NOT AN ERASURE PREDICATE (owner ruling 2026-08-25, migration
 * 0033).
 *
 * ## What this suite replaces, and why
 *
 * It stands where `resolutionPhraseOwnership.integration.test.ts` stood, and it asserts the INVERSE of what
 * that suite asserted. That suite existed for migration 0031, whose premise was that a typed phrase is
 * personal data and must therefore never sit on a row the account-erasure sweep cannot reach. The owner
 * REVERSED that on 2026-08-25: **an ingredient phrase — the original a cook typed, or a corrected one — is
 * not private data.** It does not need to be erasable, so no sweep targets it and no CHECK has to keep it
 * beside somebody to point erasure at.
 *
 * The user id survives that reversal, for a completely different reason: it is how the installation counts
 * **how many DISTINCT people made the same correction**, which is the corroboration signal that promotes a
 * correction from personal to global. That is why the column is now spelled `user_id` on both tiers rather
 * than `author_id` on one and `owner_id` on the other — one name for one concept.
 *
 * ## ⛔ Why this tier, and not a unit test
 *
 * Every claim below is one only a real PostgreSQL can answer:
 *
 *  1. **The rename actually happened in the DATABASE.** A Drizzle model renamed without its migration
 *     typechecks, passes every mocked test, and fails on the first query against a deployed schema.
 *  2. **The counter is an INDEX, not code.** "Two distinct users promote, one user twice does not" is
 *     enforced by `idx_resolution_mappings_live_user` — a partial UNIQUE index — and by the reader's
 *     `user_id <> :caller` predicate. A mock cannot break either, so a mocked test proves nothing about them.
 *  3. **A repealed CHECK is gone only if the database says so.** Deleting the constraint from the Drizzle
 *     model changes no deployed schema. The assertions below insert the exact row shapes 0031 refused and
 *     require PostgreSQL to accept them.
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

const FOOD_A = '01JU33COUNTER0000000FOODA00';
const USER_A = '01JU33COUNTER0000000USERA00';
const USER_B = '01JU33COUNTER0000000USERB00';

/** Every key this suite writes shares this prefix, so cleanup is exact and collides with no other spec. */
const PREFIX = 'u33 counter';

/**
 * The two cooks type the SAME ingredient DIFFERENTLY, which is the ordinary case.
 *
 * ⚠️ They must differ in the raw text and AGREE on the derived key, or no promotion happens and the
 * corroboration assertions would be about a binding that was never created. `normalizedIngredientKey` is
 * NFKC + invisible-strip + whitespace-collapse + trim + lowercase, so case and spacing are exactly the axes
 * that survive as raw text and vanish from the key.
 */
const PHRASE_A = `${PREFIX} Plain Flour`;
const PHRASE_B = `${PREFIX}   plain    FLOUR  `;

/** One `ingredient_resolution_mappings` row, as this suite reads it back. */
interface MappingRow {
    readonly id: string;
    readonly origin: string;
    readonly user_id: string | null;
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

describe.skipIf(!hasDatabaseUrl)('the user id is a corroboration counter (owner ruling 2026-08-25)', () => {
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
        await pool.query('DELETE FROM ingredient_parse_corrections WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Write one correction end to end, the shape the service uses: read the facts, decide, apply. */
    async function correct(rawPhrase: string, userId: string): ReturnType<ResolutionMappingsDal['applyWrite']> {
        const k = key(rawPhrase);
        const facts = await dal.findWriteFacts(k, userId, FOOD_A);
        const decision = evaluateMappingWrite({ correctedFoodId: FOOD_A, grantedScopes: [], ...facts });

        return dal.applyWrite({
            decision,
            normalizedKey: k,
            sourcePhrase: rawPhrase,
            foodId: FOOD_A,
            userId,
            surfacing: 'picker_correction',
        });
    }

    /** Every column one table declares, as PostgreSQL reports it. */
    async function columnsOf(table: string): Promise<string[]> {
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
            [table],
        );

        return rows.map((row) => row.column_name);
    }

    describe('the rename landed in the DATABASE, not only in the model', () => {
        it('⛔ spells the curated tier’s person column `user_id`, and no longer `author_id`', async () => {
            const columns = await columnsOf('ingredient_resolution_mappings');

            expect(columns).toContain('user_id');
            expect(columns).not.toContain('author_id');
        });

        it('⛔ spells the parse-correction tier’s person column `user_id` too — one name, one concept', async () => {
            const columns = await columnsOf('ingredient_parse_corrections');

            expect(columns).toContain('user_id');
            expect(columns).not.toContain('owner_id');
        });

        it('⛔ leaves the memo tier with NO person column at all', async () => {
            const columns = await columnsOf('ingredient_resolution_memos');

            // A memo is the MODEL's conclusion, not anybody's correction, so there is nothing to count. The
            // link migration 0026 added existed ONLY to give erasure a predicate; with erasure gone it was
            // the single identifying field on an otherwise impersonal row.
            expect(columns).not.toContain('owner_id');
            expect(columns).not.toContain('user_id');
            expect(columns).not.toContain('author_id');
            // …and the machine's conclusion, plus the phrase, survive.
            expect(columns).toEqual(
                expect.arrayContaining(['normalized_key', 'food_id', 'source_phrase', 'verified_by', 'verified_at']),
            );
        });

        it('keeps the corroboration counter INDEXED on the renamed column', async () => {
            const { rows } = await pool.query<{ indexdef: string }>(
                `SELECT indexdef FROM pg_indexes
                 WHERE schemaname = 'public' AND indexname = 'idx_resolution_mappings_live_user'`,
            );

            // ⛔ This index IS the distinct-user count: "a second INDEPENDENT user corroborates" is
            // implemented as a count of live author-scoped rows, and that equals a count of distinct USERS
            // only because a second live row from one user is impossible. A rename that dropped it would
            // leave the promotion rule enforced by nothing.
            expect(rows).toHaveLength(1);

            const indexdef = rows[0]?.indexdef ?? '';

            // ⚠️ Non-vacuity first: `toContain` over `''` fails, but an absent row would otherwise reach the
            // clause assertions as an empty string and every one of them would fail for the wrong reason.
            expect(indexdef).not.toBe('');
            // ⛔ THE PREDICATE, not merely the index's existence. Presence alone catches a DROP and misses a
            // RELAXATION — and a DROP+CREATE that lost `superseded_at IS NULL` is the precise hazard 0033's
            // header spends a paragraph arguing against, since it would let a superseded row keep occupying
            // a live slot. Each clause is asserted separately so a failure names which one went.
            expect(indexdef).toContain('UNIQUE');
            expect(indexdef).toContain('(normalized_key, user_id)');
            expect(indexdef).toContain("scope = 'author'");
            expect(indexdef).toContain('superseded_at IS NULL');
            expect(indexdef).toContain('user_id IS NOT NULL');
        });
    });

    describe('a phrase no longer needs somebody to point erasure at', () => {
        it('⛔ ACCEPTS a mapping carrying a phrase with no user beside it — 0031’s CHECK is repealed', async () => {
            // This is byte-for-byte the row shape migration 0031 refused with `23514`. It is now legal,
            // because the phrase is not personal data and needs no owner for a sweep to key on.
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_mappings
                         (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)
                     VALUES ($1, $2, $3, 'global', 'curator', NULL, 'test')`,
                    [key(PHRASE_A), PHRASE_A, FOOD_A],
                ),
            ).resolves.toBeDefined();
        });

        it('⛔ ACCEPTS a mapping carrying a user with no phrase — the other half of the repealed pair', async () => {
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_mappings
                         (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)
                     VALUES ($1, NULL, $2, 'author', 'author', $3, 'test')`,
                    [key(PHRASE_A), FOOD_A, USER_A],
                ),
            ).resolves.toBeDefined();
        });

        it('⛔ ACCEPTS a correction carrying a line with no user — 0029’s pair CHECK is repealed too', async () => {
            // Dropped for 0031's reason and not for a separate one: `…_owner_line_pair`'s ONLY recorded
            // justification was that a stale owner id "would aim the NEXT erasure at the wrong person".
            // There is no next erasure. Leaving it standing on one tier while the sibling tier's identical
            // constraint went would make two tiers that 0029 deliberately shaped alike disagree.
            await expect(
                pool.query(
                    `INSERT INTO ingredient_parse_corrections
                         (normalized_key, source_line, corrected_facts, scope, origin, user_id, surfacing)
                     VALUES ($1, $2, '{"unit":"cup"}'::jsonb, 'global', 'curator', NULL, 'test')`,
                    [key(PHRASE_A), PHRASE_A],
                ),
            ).resolves.toBeDefined();
        });

        // ⚠️ A fourth case stood here — "stores a memo's phrase with no user id to supply — the write path has
        // no such field" — driven through `ResolutionMappingsDal.recordMemo`. That method was an UNCALLED
        // second writer of `ingredient_resolution_memos` (the live one is `recipe-workers`'
        // `rememberAgreement`) and was deleted on 2026-09-02, so the case was asserting a claim about a write
        // path that did not exist. Its claim survives twice over, both DAL-free and both stronger: `⛔ leaves
        // the memo tier with NO person column at all` above reads the column set out of
        // `information_schema`, and `resolutionMappingsSchema.integration.test.ts`'s `⛔ ACCEPTS a phrase that
        // belongs to nobody` inserts the row and reads the phrase back.
    });

    describe('⛔ the counter: TWO distinct users promote, ONE user twice does not', () => {
        it('promotes on a second DISTINCT user, and the binding cites both of them', async () => {
            await correct(PHRASE_A, USER_A);
            const promoted = await correct(PHRASE_B, USER_B);

            expect(promoted.written).toBe(true);

            // ⚠️ Asserted through a narrowing check rather than an optional chain: `expect(x?.y)` over an
            // absent `x` passes vacuously, which would let a lost promotion read as a pass.
            if (!promoted.written) {
                throw new Error('test setup: the second correction was not written');
            }

            expect(promoted.promotion).toBeDefined();

            const { rows } = await pool.query<MappingRow>(
                `SELECT id, origin, user_id, source_phrase FROM ingredient_resolution_mappings
                 WHERE normalized_key = $1 AND origin = 'corroboration'`,
                [key(PHRASE_A)],
            );

            expect(rows).toHaveLength(1);
            // Nobody WROTE the binding — two people's agreement produced it — so it carries no user. That
            // nullability is load-bearing and survives the rename.
            expect(rows[0]?.user_id).toBeNull();
        });

        it('⛔ EXCLUDES the caller’s own live row from the corroborator set — nobody corroborates themselves', async () => {
            // ⛔ THE DIRECT GUARD ON `user_id <> :caller`, and it has to be taken at the DAL rather than
            // end-to-end. The obvious end-to-end shape — one user correcting the same phrase twice — cannot
            // reach the mutant: their own live row makes the policy answer `already_in_force` before the
            // corroborator set is ever consulted. So the predicate is asserted where it lives, on the facts
            // the policy is HANDED. Drop `user_id <> :caller` from `findWriteFacts` and this goes red.
            await correct(PHRASE_A, USER_A);

            const facts = await dal.findWriteFacts(key(PHRASE_A), USER_A, FOOD_A);

            // ⚠️ Non-vacuity first: the caller's own row really is live and really does name this food, so
            // an empty corroborator set is a predicate doing work rather than a fixture that never landed.
            expect(facts.liveOwn?.foodId).toBe(FOOD_A);
            expect(facts.corroboratorsForSameFood).toEqual([]);

            // …and a SECOND user's row does appear, so the set is not simply always empty.
            await correct(PHRASE_B, USER_B);

            const withOther = await dal.findWriteFacts(key(PHRASE_A), USER_A, FOOD_A);

            expect(withOther.corroboratorsForSameFood.map((row) => row.userId)).toEqual([USER_B]);
        });

        it('⛔ does NOT promote when the SAME user corrects twice — two accounts are not two people', async () => {
            await correct(PHRASE_A, USER_A);
            const second = await correct(PHRASE_B, USER_A);

            // ⚠️ The second write is REFUSED as already in force, and that refusal is itself the counter
            // working: re-asserting a binding that already holds would mint a churn row and inflate the count
            // that feeds promotion. `written: true` here would mean the count could be driven by one person.
            expect(second).toMatchObject({ written: false, outcome: 'already_in_force' });

            const { rows } = await pool.query<MappingRow>(
                `SELECT id, origin, user_id, source_phrase FROM ingredient_resolution_mappings
                 WHERE normalized_key = $1`,
                [key(PHRASE_A)],
            );

            // ONE row, still author-scoped — no churn row, and no corroboration binding.
            expect(rows).toHaveLength(1);
            expect(rows[0]?.origin).toBe('author');
            // …and nothing binds globally, which is what a false promotion would have produced.
            expect(await dal.findInForce(key(PHRASE_A), undefined)).toBeUndefined();
        });

        it('keeps BOTH users’ phrases verbatim beside their own ids — the two-way door is intact', async () => {
            await correct(PHRASE_A, USER_A);
            await correct(PHRASE_B, USER_B);

            const { rows } = await pool.query<MappingRow>(
                `SELECT id, origin, user_id, source_phrase FROM ingredient_resolution_mappings
                 WHERE normalized_key = $1 AND origin = 'author' ORDER BY user_id`,
                [key(PHRASE_A)],
            );

            expect(rows.map((row) => [row.user_id, row.source_phrase])).toEqual([
                [USER_A, PHRASE_A],
                [USER_B, PHRASE_B],
            ]);
        });
    });
});
