/**
 * U10 — `ResolutionMappingsDal` AGAINST A REAL POSTGRES (plan U10 / R14, R19, R20).
 *
 * ⛔ WHY THIS TIER. Every rule this DAL enforces lives in a `WHERE` clause, and the plan's own problem frame
 * records what a mocked DAL test proves about a `WHERE` clause: nothing. "The recipe-side DAL test is
 * mock-only and asserts call counts; it passes with the `WHERE` clause arbitrarily broken." The clauses here
 * are not conveniences — three of them ARE the authorization:
 *
 *  1. **`user_id = :caller` inside the supersede `UPDATE`** is what makes "an author-scoped mapping is
 *     superseded only by the user who wrote it" unforgeable. Zero rows returned IS the denial; there is no
 *     branch to bypass, and no id a caller can pass that reaches somebody else's row.
 *  2. **`ON CONFLICT DO NOTHING` on the promotion insert** is what makes the concurrent-promotion race have a
 *     LOSER rather than an ERROR. The loser reads zero rows as "somebody else already promoted", does not
 *     emit an audit signal, and does not fail the user's correction.
 *  3. **`(scope = 'global' OR user_id = :caller)` with `$2::text IS NOT NULL`** is what makes an unattended
 *     import (R22 — no user at all) see global mappings and nobody's personal ones.
 *
 * ⚠️ The column is `user_id` since migration 0033 (owner ruling 2026-08-25, ADR-0027) and is deliberately NOT
 * erasable: it is the distinct-user corroboration counter as well as two of the three clauses above.
 *
 * And the near-twin lookup can only be proved against a database that actually has `pg_trgm` and the GiST
 * index; in Node it would be a mock returning whatever the test told it to.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    normalizedIngredientKey,
    type NormalizedIngredientKey,
} from '@kitchensink/recipe-core/resolution/normalized-key';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { evaluateMappingWrite, CURATOR_MAPPING_SCOPE } from '../../../src/ingredients/domain/mappingScopePolicy.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const FOOD_A = '01JU10DAL00000000000000FOODA';
const FOOD_B = '01JU10DAL00000000000000FOODB';
const AUTHOR_A = '01JU10DAL0000000000000AUTHA';
const AUTHOR_B = '01JU10DAL0000000000000AUTHB';
/** Every key this suite writes shares this prefix, so cleanup is exact and collides with no other spec. */
const PREFIX = 'u10 dal';

/** Build a key inside this suite's namespace. Throws on an unusable phrase — a test-setup error, not a case. */
function key(phrase: string): NormalizedIngredientKey {
    const built = normalizedIngredientKey(`${PREFIX} ${phrase}`);

    if (built === undefined) {
        throw new Error(`test setup: "${phrase}" produced no key`);
    }

    return built;
}

describe.skipIf(!hasDatabaseUrl)('ResolutionMappingsDal', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: ResolutionMappingsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new ResolutionMappingsDal(db);
    });

    afterEach(async () => {
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

    /** Write one correction end to end: read the facts, decide, apply. The shape the service uses. */
    async function correct(
        phrase: string,
        userId: string,
        foodId: string,
        grantedScopes: readonly string[] = [],
    ): ReturnType<ResolutionMappingsDal['applyWrite']> {
        const k = key(phrase);
        const facts = await dal.findWriteFacts(k, userId, foodId);
        const decision = evaluateMappingWrite({ correctedFoodId: foodId, grantedScopes, ...facts });

        return dal.applyWrite({
            decision,
            normalizedKey: k,
            sourcePhrase: `${PREFIX} ${phrase}`,
            foodId,
            userId,
            surfacing: 'picker_correction',
        });
    }

    /**
     * Seed one memo row directly.
     *
     * ⛔ RAW SQL, and deliberately not a DAL method. This DAL is the memo tier's READER; the only writer of
     * `ingredient_resolution_memos` is `recipe-workers`' `createVerdictStore().rememberAgreement`, which this
     * package cannot import (recipe-workers exports `./infra` alone, and `common/db.ts` records the refusal to
     * couple the two in the other direction). `ResolutionMappingsDal.recordMemo` used to stand in — an
     * uncalled second writer of the same statement, deleted 2026-09-02. Seeding through it made these read
     * specs look like round-trips they were never running: nothing in production wrote a memo that way.
     *
     * @param normalizedKey - The key the row is stored under.
     * @param foodId - The remembered food.
     * @sideEffect Inserts into `ingredient_resolution_memos`.
     */
    async function seedMemo(normalizedKey: NormalizedIngredientKey, foodId: string): Promise<void> {
        await pool.query(
            `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
             VALUES ($1, $2, $3, 'test-model-v1')`,
            [normalizedKey, foodId, normalizedKey],
        );
    }

    describe('findInForce — tier 1 precedence (R19)', () => {
        it('returns nothing when the phrase has never been corrected', async () => {
            expect(await dal.findInForce(key('unseen phrase'), AUTHOR_A)).toBeUndefined();
        });

        it('returns the caller’s OWN mapping ahead of the global one', async () => {
            await correct('plain flour', AUTHOR_B, FOOD_A, [CURATOR_MAPPING_SCOPE]);
            await correct('plain flour', AUTHOR_A, FOOD_B);

            const own = await dal.findInForce(key('plain flour'), AUTHOR_A);
            const other = await dal.findInForce(key('plain flour'), AUTHOR_B);

            expect(own?.foodId).toBe(FOOD_B);
            expect(own?.scope).toBe('author');
            // …and another caller still sees the global one. A user's correction binds them, not everybody.
            expect(other?.foodId).toBe(FOOD_A);
            expect(other?.scope).toBe('global');
        });

        it('shows an UNATTENDED caller the global mapping and NOBODY’S personal one (R22)', async () => {
            await correct('caster sugar', AUTHOR_A, FOOD_B);

            // No author at all — the importer. An author-scoped mapping must not leak into it, or one user's
            // private correction would silently rewrite every unattended import.
            expect(await dal.findInForce(key('caster sugar'), undefined)).toBeUndefined();

            await correct('caster sugar', AUTHOR_B, FOOD_A, [CURATOR_MAPPING_SCOPE]);

            expect((await dal.findInForce(key('caster sugar'), undefined))?.foodId).toBe(FOOD_A);
        });

        it('ignores a SUPERSEDED mapping — history is readable but never in force', async () => {
            await correct('brown sugar', AUTHOR_A, FOOD_A);
            await correct('brown sugar', AUTHOR_A, FOOD_B);

            expect((await dal.findInForce(key('brown sugar'), AUTHOR_A))?.foodId).toBe(FOOD_B);

            const { rows } = await pool.query(
                'SELECT id FROM ingredient_resolution_mappings WHERE normalized_key = $1',
                [key('brown sugar')],
            );

            // Both rows survive: R20's audit trail needs the retired one to stay readable.
            expect(rows).toHaveLength(2);
        });
    });

    describe('applyWrite — supersession is authorized inside the WHERE clause', () => {
        it('supersedes the caller’s own earlier mapping and links the successor', async () => {
            const first = await correct('rye flour', AUTHOR_A, FOOD_A);
            const second = await correct('rye flour', AUTHOR_A, FOOD_B);

            expect(first.written).toBe(true);
            expect(second.written).toBe(true);

            const { rows } = await pool.query<{ id: string; superseded_by: string | null }>(
                'SELECT id, superseded_by FROM ingredient_resolution_mappings WHERE normalized_key = $1 ORDER BY created_at, id',
                [key('rye flour')],
            );

            const retired = rows.find((row) => row.superseded_by !== null);

            expect(retired).toBeDefined();
            expect(retired!.superseded_by).toBe(second.written ? second.mappingId : null);
        });

        it('⛔ CANNOT supersede another author’s mapping — the id is not enough, the WHERE clause is the gate', async () => {
            await correct('spelt flour', AUTHOR_A, FOOD_A);

            const { rows } = await pool.query<{ id: string }>(
                'SELECT id FROM ingredient_resolution_mappings WHERE normalized_key = $1',
                [key('spelt flour')],
            );

            // Hand the DAL author A's row id while acting as author B — the forged-supersession attempt. The
            // statement's `user_id = :caller` predicate matches nothing, so it retires nothing.
            const retired = await dal.supersedeOwnMapping(rows[0]!.id, AUTHOR_B);

            expect(retired).toBe(false);

            const { rows: after } = await pool.query<{ superseded_at: Date | null }>(
                'SELECT superseded_at FROM ingredient_resolution_mappings WHERE id = $1',
                [rows[0]!.id],
            );

            expect(after[0]!.superseded_at).toBeNull();
        });

        it('a curator’s correction retires the live global mapping and binds the phrase globally', async () => {
            await correct('bread flour', AUTHOR_A, FOOD_A, [CURATOR_MAPPING_SCOPE]);
            await correct('bread flour', AUTHOR_B, FOOD_B, [CURATOR_MAPPING_SCOPE]);

            const inForce = await dal.findInForce(key('bread flour'), undefined);

            expect(inForce?.foodId).toBe(FOOD_B);
            expect(inForce?.origin).toBe('curator');
        });

        it('writes NOTHING for a correction that changes nothing', async () => {
            await correct('oat flour', AUTHOR_A, FOOD_A);
            const repeat = await correct('oat flour', AUTHOR_A, FOOD_A);

            expect(repeat.written).toBe(false);

            const { rows } = await pool.query(
                'SELECT id FROM ingredient_resolution_mappings WHERE normalized_key = $1',
                [key('oat flour')],
            );

            expect(rows).toHaveLength(1);
        });
    });

    describe('applyWrite — promotion by corroboration (R20 / AE7)', () => {
        it('promotes on a second DISTINCT author, writing a citing row rather than flipping an existing one', async () => {
            await correct('corn flour', AUTHOR_A, FOOD_A);
            const second = await correct('corn flour', AUTHOR_B, FOOD_A);

            expect(second.written).toBe(true);
            expect(second.written && second.promotion).toBeDefined();

            const { rows } = await pool.query<{
                id: string;
                scope: string;
                origin: string;
                user_id: string | null;
                corroborated_a: string | null;
                corroborated_b: string | null;
            }>(
                `SELECT id, scope, origin, user_id, corroborated_a, corroborated_b
                 FROM ingredient_resolution_mappings WHERE normalized_key = $1 ORDER BY created_at, id`,
                [key('corn flour')],
            );

            // Three rows: A's, B's, and the corroboration binding — NOT two with one flipped. Flipping would
            // rewrite the meaning of a record its author authored (R20's "from which surfacing").
            expect(rows).toHaveLength(3);

            const binding = rows.find((row) => row.origin === 'corroboration');

            expect(binding).toBeDefined();
            expect(binding!.scope).toBe('global');
            // Nobody wrote it — two people's agreement produced it — so it is attributed to no author.
            expect(binding!.user_id).toBeNull();
            expect(binding!.corroborated_a).not.toBeNull();
            expect(binding!.corroborated_b).not.toBeNull();
            expect(binding!.corroborated_a).not.toBe(binding!.corroborated_b);

            // …and the binding is what an unattended caller now resolves through.
            expect((await dal.findInForce(key('corn flour'), undefined))?.origin).toBe('corroboration');
        });

        it('does NOT promote when the SAME author corrects twice', async () => {
            await correct('barley flour', AUTHOR_A, FOOD_B);
            const again = await correct('barley flour', AUTHOR_A, FOOD_A);

            expect(again.written && again.promotion).toBeUndefined();
            expect(await dal.findInForce(key('barley flour'), undefined)).toBeUndefined();
        });

        it('does NOT promote when the two authors name DIFFERENT foods', async () => {
            await correct('millet flour', AUTHOR_A, FOOD_A);
            const disagreeing = await correct('millet flour', AUTHOR_B, FOOD_B);

            // Agreement is on the FOOD, not merely on the phrase being wrong. Two people who disagree about
            // the answer have corroborated nothing.
            expect(disagreeing.written && disagreeing.promotion).toBeUndefined();
            expect(await dal.findInForce(key('millet flour'), undefined)).toBeUndefined();
        });

        it('⛔ does NOT let a corroboration pair displace a CURATOR’s global mapping', async () => {
            await correct('almond flour', '01JU10DAL000000000000CURAT', FOOD_B, [CURATOR_MAPPING_SCOPE]);
            await correct('almond flour', AUTHOR_A, FOOD_A);
            const second = await correct('almond flour', AUTHOR_B, FOOD_A);

            expect(second.written && second.promotion).toBeUndefined();

            // The curator's ruling still stands for everyone who has not personally corrected it.
            const inForce = await dal.findInForce(key('almond flour'), '01JU10DAL0000000000000OTHER');

            expect(inForce?.foodId).toBe(FOOD_B);
            expect(inForce?.origin).toBe('curator');
        });

        it('a SECOND promotion attempt for the same pair is a no-op, not an error (the concurrent race)', async () => {
            await correct('rice flour', AUTHOR_A, FOOD_A);
            const promoted = await correct('rice flour', AUTHOR_B, FOOD_A);

            expect(promoted.written && promoted.promotion).toBeDefined();

            // Replay the exact promotion the loser of a concurrent race would attempt. `ON CONFLICT DO
            // NOTHING` makes it return "already promoted" rather than raising 23505 and failing the write.
            const replayed = await dal.promoteByCorroboration({
                normalizedKey: key('rice flour'),
                foodId: FOOD_A,
                citesExisting: (promoted.written && promoted.promotion!.citesExisting) as string,
                citesNew: (promoted.written && promoted.mappingId) as string,
                supersedesGlobal: undefined,
            });

            expect(replayed).toBeUndefined();
        });
    });

    describe('memos — the machine-derived tier (R14, R21)', () => {
        it('answers an EXACT key before it ever considers a neighbour', async () => {
            await seedMemo(key('vanilla extract'), FOOD_A);

            const hit = await dal.findMemo(key('vanilla extract'));

            expect(hit).toEqual({ foodId: FOOD_A, match: 'exact', similarity: 1 });
        });

        it('answers a NEAR-TWIN the knowledge base has never seen verbatim (AE8)', async () => {
            await seedMemo(key('all-purpose flour'), FOOD_A);

            // ⚠️ MEASURED, not assumed: `pg_trgm` splits on non-alphanumerics, so `all-purpose` and
            // `all purpose` produce IDENTICAL trigram sets and score 1.0 — while the keys themselves differ,
            // so the exact lookup misses. That gap between "the strings are equal" and "the trigrams are
            // equal" is precisely what R14 means by "equality-only matching does not satisfy this
            // requirement", and it is why the hit must still be reported as `near`.
            const hit = await dal.findMemo(key('all purpose flour'));

            expect(hit?.foodId).toBe(FOOD_A);
            expect(hit?.match).toBe('near');
            expect(hit!.similarity).toBeGreaterThan(0.5);
        });

        it('answers a twin that is genuinely LESS similar, above the floor', async () => {
            await seedMemo(key('unbleached bread flour'), FOOD_B);

            const hit = await dal.findMemo(key('unbleached bread flours'));

            expect(hit?.foodId).toBe(FOOD_B);
            expect(hit?.match).toBe('near');
            // Strictly below 1 — a real approximate match rather than a punctuation fold, so this case proves
            // the k-NN ordering itself and not just the tokenizer.
            expect(hit!.similarity).toBeGreaterThan(0.5);
            expect(hit!.similarity).toBeLessThan(1);
        });

        it('refuses a neighbour that is merely the CLOSEST rather than close ENOUGH', async () => {
            await seedMemo(key('smoked paprika'), FOOD_A);

            // A k-NN search ALWAYS returns something when the table is non-empty — that is what makes an
            // unbounded nearest-neighbour tier dangerous rather than merely imprecise. The similarity floor is
            // the whole difference between "resolves a near-twin" and "resolves anything at all".
            expect(await dal.findMemo(key('bay leaves'))).toBeUndefined();
        });
    });
});
