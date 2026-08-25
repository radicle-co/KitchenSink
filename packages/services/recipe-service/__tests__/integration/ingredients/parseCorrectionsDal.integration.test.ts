/**
 * U21 — `ParseCorrectionsDal` AGAINST A REAL POSTGRES (plan U21 / KTD-14, KTD-15).
 *
 * ⛔ WHY THIS TIER. Every rule this DAL enforces lives in a `WHERE` clause or an index, and neither is
 * observable from a mock. Four of them are load-bearing:
 *
 *  1. **`owner_id = :caller` inside the supersede `UPDATE`** is what makes "an author-scoped correction is
 *     superseded only by the cook who made it" unforgeable. Zero rows IS the denial — no branch to bypass,
 *     and no id a caller can pass that reaches somebody else's row.
 *  2. **`(scope = 'global' OR (:caller IS NOT NULL AND owner_id = :caller))`** is what keeps one cook's
 *     personal correction OUT of every other cook's pipeline — and what lets an unattended import, which has
 *     no user at all, see global corrections and nobody's personal ones.
 *  3. **`ON CONFLICT DO NOTHING` on the promotion insert** is what makes the concurrent-promotion race have a
 *     LOSER rather than an ERROR.
 *  4. ⛔ **PostgreSQL's `jsonb` canonicalization IS the answer's identity.** The policy compares two opaque
 *     strings; what makes those strings comparable is that both come out of the database. Only a real
 *     database can prove that two parses written with their keys in different orders corroborate each other
 *     rather than sitting beside each other as a disagreement — and getting that wrong would make promotion
 *     unreachable in practice while every unit test stayed green.
 *
 * ⚠️ NOT COVERED HERE, and deliberately: "a correction outranks a cached parse" and "a correction outranks
 * both live engines". Those are properties of the pipeline's ORDER, which U22's `parsePipeline.ts` owns and
 * which does not exist yet — asserting them from this DAL would mean asserting that a read of ONE table read
 * that table, which proves nothing. What U21 owes them is that the tier this DAL exposes is correct and
 * reachable; U22 owes the order.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    normalizedIngredientKey,
    type NormalizedIngredientKey,
} from '@kitchensink/recipe-core/resolution/normalized-key';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { CURATOR_MAPPING_SCOPE } from '../../../src/ingredients/domain/mappingScopePolicy.js';
import {
    CURATOR_PARSE_SCOPE,
    evaluateParseCorrectionWrite,
} from '../../../src/ingredients/domain/parseCorrectionPolicy.js';
import { ParseCorrectionsDal } from '../../../src/ingredients/dal/parseCorrections.dal.js';
import type { CorrectedParse } from '../../../src/database/schema/ingredientParseCorrections.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const COOK_A = '01JU21DAL0000000000000COOKA';
const COOK_B = '01JU21DAL0000000000000COOKB';
const COOK_C = '01JU21DAL0000000000000COOKC';

/** Every key this suite writes shares this prefix, so cleanup is exact and collides with no other spec. */
const PREFIX = 'u21 dal';

/** One corrected parse. */
const FLOUR: CorrectedParse = { unit: 'cup', foods: [{ name: 'plain flour', prep: 'sifted' }] };

/** The SAME parse with its keys written in the opposite order — a different JS object, one `jsonb` value. */
const FLOUR_REORDERED: CorrectedParse = { foods: [{ prep: 'sifted', name: 'plain flour' }], unit: 'cup' };

/** A genuinely different parse. */
const SELF_RAISING: CorrectedParse = { unit: 'cup', foods: [{ name: 'self-raising flour', prep: null }] };

/**
 * Build a key inside this suite's namespace.
 *
 * @param line - The raw ingredient line.
 * @returns The branded key. Throws on an unusable line — a test-setup error, not a case under test.
 */
function key(line: string): NormalizedIngredientKey {
    const built = normalizedIngredientKey(`${PREFIX} ${line}`);

    if (built === undefined) {
        throw new Error(`test setup: "${line}" produced no key`);
    }

    return built;
}

describe.skipIf(!hasDatabaseUrl)('ParseCorrectionsDal', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: ParseCorrectionsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new ParseCorrectionsDal(db);
    });

    afterEach(async () => {
        // Citations first: a corroboration row references the two author rows, so it must go before them.
        await pool.query(
            `DELETE FROM ingredient_parse_corrections WHERE normalized_key LIKE $1 AND origin = 'corroboration'`,
            [`${PREFIX}%`],
        );
        await pool.query('DELETE FROM ingredient_parse_corrections WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /**
     * Write one correction end to end: read the facts under the lock, decide, apply. The shape a caller uses.
     *
     * @param line - The raw ingredient line being corrected.
     * @param ownerId - The cook making the correction.
     * @param facts - The parse they assert.
     * @param grantedScopes - Their grants.
     * @returns What was written.
     * @sideEffect Reads and writes `ingredient_parse_corrections`.
     */
    async function correct(
        line: string,
        ownerId: string,
        facts: CorrectedParse,
        grantedScopes: readonly string[] = [],
    ): ReturnType<ParseCorrectionsDal['applyWrite']> {
        const k = key(line);

        return dal.runInTransaction(async (tx) => {
            const writeFacts = await dal.findWriteFacts(k, ownerId, facts, tx);
            const decision = evaluateParseCorrectionWrite({
                correctedAnswer: writeFacts.canonicalAnswer,
                grantedScopes,
                liveGlobal: writeFacts.liveGlobal,
                liveOwn: writeFacts.liveOwn,
                corroboratorsForSameAnswer: writeFacts.corroboratorsForSameAnswer,
            });

            return dal.applyWrite(
                {
                    decision,
                    normalizedKey: k,
                    sourceLine: `${PREFIX} ${line}`,
                    correctedFacts: facts,
                    ownerId,
                    surfacing: 'line_correction',
                },
                tx,
            );
        });
    }

    describe('findInForce — the tier’s read', () => {
        it('returns nothing when the line has never been corrected', async () => {
            expect(await dal.findInForce(key('unseen line'), COOK_A)).toBeUndefined();
        });

        it('⛔ an author-scoped correction does NOT leak to another cook', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);

            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_A)).toMatchObject({
                scope: 'author',
                facts: FLOUR,
            });
            // The whole point of the author scope. A leak here would apply one cook's private reading of a
            // line to every other cook's recipe, from a single unreviewed correction.
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_B)).toBeUndefined();
        });

        it('⛔ an author-scoped correction is invisible to an UNATTENDED caller (no user at all)', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);

            // ⚠️ Stated honestly: this pins the BEHAVIOUR, not the spelling. `owner_id = NULL` evaluates to
            // NULL and excludes the row too, so the explicit `:caller IS NOT NULL` in the predicate is a
            // readability guard against a reviewer trap rather than something a test can distinguish. What
            // this WOULD catch is a predicate that let a null caller through — e.g. one rewritten to
            // `coalesce(owner_id, '') = coalesce(:caller, '')`, which reads as harmless and hands every
            // unattended import every cook's personal correction.
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), undefined)).toBeUndefined();
        });

        it('a grant holder’s correction is in force for EVERY cook, and for an unattended caller', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR, [CURATOR_PARSE_SCOPE]);

            for (const caller of [COOK_A, COOK_B, undefined]) {
                expect(await dal.findInForce(key('2 cups plain flour, sifted'), caller)).toMatchObject({
                    scope: 'global',
                    origin: 'curator',
                    facts: FLOUR,
                });
            }
        });

        it('prefers the caller’s OWN correction over the global one in force', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR, [CURATOR_PARSE_SCOPE]);
            await correct('2 cups plain flour, sifted', COOK_B, SELF_RAISING);

            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_B)).toMatchObject({
                scope: 'author',
                facts: SELF_RAISING,
            });
        });

        it('⛔ a DE-IDENTIFIED row is in force for nobody — erasure does not orphan a personal correction', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            await pool.query(
                `UPDATE ingredient_parse_corrections SET owner_id = NULL, source_line = NULL
                 WHERE owner_id = $1`,
                [COOK_A],
            );

            // The erasure sweep leaves the row so the correction survives where it BOUND — globally. An
            // author-scoped row whose owner is gone binds nobody, and must not silently become everybody's.
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_A)).toBeUndefined();
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), undefined)).toBeUndefined();
        });
    });

    describe('the write decision, executed', () => {
        it('⛔ the MAPPING grant buys nothing here — an ungranted write is what lands', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR, [CURATOR_MAPPING_SCOPE]);

            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_B)).toBeUndefined();
        });

        it('a second INDEPENDENT cook asserting the same parse promotes it to global', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            const second = await correct('2 cups plain flour, sifted', COOK_B, FLOUR);

            expect(second.written && second.promotion).toBeDefined();
            // The promotion is a NEW row citing both, never a flip of either cook's own — which is what keeps
            // both cooks' personal corrections intact and the binding auditable by `SELECT`.
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_C)).toMatchObject({
                scope: 'global',
                origin: 'corroboration',
                facts: FLOUR,
            });
        });

        it('⛔ promotes across a KEY-ORDER difference — the identity is Postgres’ canonical jsonb', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            const second = await correct('2 cups plain flour, sifted', COOK_B, FLOUR_REORDERED);

            // Two cooks correcting the same line to the same parse must AGREE, whatever order the producer
            // happened to serialize the object in. A TypeScript-side comparison would call these different
            // and make corroboration unreachable in practice, with nothing failing anywhere.
            expect(second.written && second.promotion).toBeDefined();
        });

        it('the SAME cook correcting twice does not promote — corroboration needs two people', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, SELF_RAISING);
            const again = await correct('2 cups plain flour, sifted', COOK_A, FLOUR);

            expect(again.written && again.promotion).toBeUndefined();
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_B)).toBeUndefined();
        });

        it('re-asserting what the cook already holds writes nothing (no churn row, no inflated count)', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            const repeat = await correct('2 cups plain flour, sifted', COOK_A, FLOUR_REORDERED);

            expect(repeat).toMatchObject({ written: false, outcome: 'already_in_force' });
        });

        it('a cook’s later correction supersedes their own earlier one, leaving one live row', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            await correct('2 cups plain flour, sifted', COOK_A, SELF_RAISING);

            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_A)).toMatchObject({
                facts: SELF_RAISING,
            });

            const live = await pool.query(
                `SELECT count(*)::int AS n FROM ingredient_parse_corrections
                 WHERE normalized_key LIKE $1 AND scope = 'author' AND superseded_at IS NULL`,
                [`${PREFIX}%`],
            );

            expect(live.rows[0]).toEqual({ n: 1 });
        });

        it('⛔ a fresh corroborating pair does NOT displace a CURATOR’s global correction', async () => {
            await correct('2 cups plain flour, sifted', COOK_A, SELF_RAISING, [CURATOR_PARSE_SCOPE]);
            await correct('2 cups plain flour, sifted', COOK_B, FLOUR);
            await correct('2 cups plain flour, sifted', COOK_C, FLOUR);

            // Two accounts held by one person clear a distinct-author check, so allowing this would move the
            // escalation from the edit path to the corroboration path and make the grant decorative.
            expect(
                await dal.findInForce(key('2 cups plain flour, sifted'), '01JU21DAL000000000000BYSTA'),
            ).toMatchObject({ origin: 'curator', facts: SELF_RAISING });
        });
    });

    describe('supersedeOwnCorrection — the predicate IS the authorization', () => {
        it('refuses to retire another cook’s row, and reports it by returning false', async () => {
            const written = await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            const id = written.written ? written.correctionId : '';

            // A caller holding another cook's row id retires nothing: the statement matches no row, and zero
            // rows IS the denial — atomically, with no check a caller could be trusted to have run first.
            expect(await dal.supersedeOwnCorrection(id, COOK_B)).toBe(false);
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_A)).toBeDefined();
        });

        it('retires the cook’s own row', async () => {
            const written = await correct('2 cups plain flour, sifted', COOK_A, FLOUR);
            const id = written.written ? written.correctionId : '';

            expect(await dal.supersedeOwnCorrection(id, COOK_A)).toBe(true);
            expect(await dal.findInForce(key('2 cups plain flour, sifted'), COOK_A)).toBeUndefined();
        });
    });
});
