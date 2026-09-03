/**
 * The verdict store against a REAL PostgreSQL — the write surface the verification gate is allowed.
 *
 * ⛔ WHY THIS TIER EXISTS, in this file's case with a shipped defect as the proof: `recordVerdict` interpolated
 * its `aspects` array directly into drizzle's `sql` template, which expands a bare array into a parameter LIST
 * — `($5, $6)`, a record — while the column is `text[]`. Every real INSERT failed with "column \"aspects\" is
 * of type text[] but expression is of type record", the handler metered-and-swallowed the failure by design
 * ("nothing after the money is spent may fail the handler"), and the unit suite's fake store proved only that
 * the method was called. Found live on 2026-08-31 when the first full-corpus drain lost its first twelve
 * verdicts AFTER Bedrock was paid. A mocked test structurally cannot catch this; this one fails on the broken
 * spelling and pins the working one.
 *
 * Runs against `DATABASE_URL` (a recipe database with migrations applied); skipped without it, run in CI.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import { createVerdictStore } from '../../../src/verification/verdictStore.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

const KEY_PREFIX = 'it-verdict-store';

describe.skipIf(!canRun)('createVerdictStore (integration)', () => {
    let pool: pg.Pool;
    let store: ReturnType<typeof createVerdictStore>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        store = createVerdictStore(drizzle(pool));
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key LIKE '${KEY_PREFIX}%'`);
        await pool.query(`DELETE FROM ingredient_resolution_memos WHERE source_phrase LIKE '${KEY_PREFIX}%'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('lands a verdict with a MULTI-element aspects array in the text[] column', async () => {
        await store.recordVerdict({
            verificationKey: `${KEY_PREFIX}-multi`,
            verdict: 'agree',
            certainty: 'high',
            band: 'verified',
            aspects: ['identity', 'quantity'],
            modelId: 'amazon.nova-micro-v1:0',
            foodId: '01M13XKKV183RCVG7NB8T0NFKF',
        });

        const { rows } = await pool.query(
            `SELECT verdict, certainty, band, aspects, model_id FROM recipe_ingredient_verifications
              WHERE verification_key = $1`,
            [`${KEY_PREFIX}-multi`],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            verdict: 'agree',
            certainty: 'high',
            band: 'verified',
            aspects: ['identity', 'quantity'],
            model_id: 'amazon.nova-micro-v1:0',
        });
    });

    it('lands a SINGLE-element aspects array too — the shape a list-expansion bug reads as a bare scalar', async () => {
        await store.recordVerdict({
            verificationKey: `${KEY_PREFIX}-single`,
            verdict: 'abstain',
            certainty: 'low',
            band: 'inconclusive',
            aspects: ['identity'],
            modelId: 'amazon.nova-micro-v1:0',
            foodId: '01M13XKKV183RCVG7NB8T0NFKF',
        });

        const { rows } = await pool.query(
            `SELECT aspects FROM recipe_ingredient_verifications WHERE verification_key = $1`,
            [`${KEY_PREFIX}-single`],
        );

        expect(rows[0]?.aspects).toEqual(['identity']);
    });

    it('lands the per-aspect verdicts (migration 0042), and NULL when the answer carried none', async () => {
        await store.recordVerdict({
            verificationKey: `${KEY_PREFIX}-aspects`,
            verdict: 'disagree',
            certainty: 'high',
            band: 'contradicted',
            aspects: ['identity', 'quantity'],
            identityVerdict: 'agree',
            quantityVerdict: 'disagree',
            modelId: 'amazon.nova-micro-v1:0',
            foodId: '01M13XKKV183RCVG7NB8T0NFKF',
        });
        await store.recordVerdict({
            verificationKey: `${KEY_PREFIX}-no-aspects`,
            verdict: 'agree',
            certainty: 'high',
            band: 'verified',
            aspects: ['identity', 'quantity'],
            modelId: 'amazon.nova-micro-v1:0',
            foodId: '01M13XKKV183RCVG7NB8T0NFKF',
        });

        const { rows } = await pool.query(
            `SELECT verification_key, identity_verdict, quantity_verdict FROM recipe_ingredient_verifications
              WHERE verification_key LIKE '${KEY_PREFIX}%' ORDER BY verification_key`,
        );

        expect(rows).toEqual([
            { verification_key: `${KEY_PREFIX}-aspects`, identity_verdict: 'agree', quantity_verdict: 'disagree' },
            { verification_key: `${KEY_PREFIX}-no-aspects`, identity_verdict: null, quantity_verdict: null },
        ]);
    });

    it('the CHECK refuses a per-aspect value outside the verdict enum', async () => {
        await expect(
            store.recordVerdict({
                verificationKey: `${KEY_PREFIX}-bad-aspect`,
                verdict: 'agree',
                certainty: 'high',
                band: 'verified',
                aspects: ['identity'],
                identityVerdict: 'maybe',
                modelId: 'amazon.nova-micro-v1:0',
                foodId: '01M13XKKV183RCVG7NB8T0NFKF',
            }),
        ).rejects.toThrow();
    });

    it('upserts on the verification key: a re-verification supersedes rather than erroring or duplicating', async () => {
        const row = {
            verificationKey: `${KEY_PREFIX}-upsert`,
            verdict: 'agree',
            certainty: 'high',
            band: 'verified',
            aspects: ['identity'],
            modelId: 'amazon.nova-micro-v1:0',
            foodId: '01M13XKKV183RCVG7NB8T0NFKF',
        };

        await store.recordVerdict(row);
        await store.recordVerdict({
            ...row,
            verdict: 'disagree',
            band: 'contradicted',
            aspects: ['identity', 'quantity'],
        });

        const { rows } = await pool.query(
            `SELECT verdict, band, aspects FROM recipe_ingredient_verifications WHERE verification_key = $1`,
            [`${KEY_PREFIX}-upsert`],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ verdict: 'disagree', band: 'contradicted', aspects: ['identity', 'quantity'] });
    });

    it('remembers an agreement in the memo table, keyed on the normalized PHRASE', async () => {
        await store.rememberAgreement({
            phrase: `${KEY_PREFIX} Chopped Onions`,
            foodId: '01M13XBBPQQNBDNTMH0BQ4BYJ2',
            modelId: 'amazon.nova-micro-v1:0',
        });

        const { rows } = await pool.query(
            `SELECT food_id, verified_by FROM ingredient_resolution_memos WHERE source_phrase = $1`,
            [`${KEY_PREFIX} Chopped Onions`],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ food_id: '01M13XBBPQQNBDNTMH0BQ4BYJ2', verified_by: 'amazon.nova-micro-v1:0' });
    });

    it('upserts the memo on the normalized key: a newer model REPLACES the remembered food, never duplicating it', async () => {
        // PORTED from `recipe-service`'s `resolutionMappingsDal.integration.test.ts`, which asserted this of
        // `ResolutionMappingsDal.recordMemo` — a second, uncalled writer of this table, now deleted. The claim
        // is `rememberAgreement`'s and had no test on the LIVE statement: the sibling schema suite
        // (`resolutionMappingsSchema.integration.test.ts`) proves the TABLE supports the upsert by issuing its
        // own SQL, which says nothing about the statement this store actually sends.
        //
        // The rule it pins is the one the module docstring gives: `DO UPDATE` rather than `DO NOTHING`, so a
        // re-verification under a newer judge supersedes the older answer instead of being silently dropped —
        // a memo is a food id, not a vector, so a newer answer is comparable to the old one and beats it.
        const phrase = `${KEY_PREFIX} Golden Syrup`;

        await store.rememberAgreement({ phrase, foodId: '01M13XKKV183RCVG7NB8T0NFKF', modelId: 'model-v1' });
        await store.rememberAgreement({ phrase, foodId: '01M13XBBPQQNBDNTMH0BQ4BYJ2', modelId: 'model-v2' });

        const { rows } = await pool.query<{ food_id: string; verified_by: string }>(
            `SELECT food_id, verified_by FROM ingredient_resolution_memos WHERE normalized_key = $1`,
            [normalizedIngredientKey(phrase)],
        );

        // Exactly ONE row — a memo that accumulated beside its predecessor would make the tier's `LIMIT 1`
        // exact read return whichever row the planner happened to reach first.
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ food_id: '01M13XBBPQQNBDNTMH0BQ4BYJ2', verified_by: 'model-v2' });
    });

    it('⛔ PINS the grain: the stored key IS normalizedIngredientKey(phrase), the value the cascade queries with', async () => {
        // The whole 0041 repair is this identity (owner ruling 2026-08-31): the memo tier's read side asks
        // `normalizedIngredientKey(name)` for the phrase a picker types, so the write side must produce the
        // SAME key from the SAME function over the SAME phrase. U15 measured what happens when they differ:
        // 289 memos keyed on whole lines, none of which could ever serve any query. A drift in either
        // direction — the write keying on something else, or a second normalizer — fails here.
        const phrase = `${KEY_PREFIX} Cold Water`;
        await store.rememberAgreement({
            phrase,
            foodId: '01M13XN0T7CTXKSYHZMZR7Y8VB',
            modelId: 'amazon.nova-micro-v1:0',
        });

        const { rows } = await pool.query(
            `SELECT normalized_key FROM ingredient_resolution_memos WHERE source_phrase = $1`,
            [phrase],
        );

        expect(rows[0]?.normalized_key).toBe(normalizedIngredientKey(phrase));
    });
});
