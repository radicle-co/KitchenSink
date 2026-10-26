/**
 * A PASTE-JOB line through the verification gate, against real PostgreSQL (ADR-0071).
 *
 * ⛔ WHY THIS TIER. The claim this file proves is about the SHARED tables, and only a real database can show it:
 * the band store finds the band a verdict belongs to by reading the food's latest LEXICAL `ingredient_resolutions`
 * event, not the message. A paste proposal writes no such event, so when one EXISTS for the food it belongs to some
 * other cook's saved line — and the real `createBandFeedback` would happily file the paste verdict under that
 * stranger's band. Seeding exactly that event and observing no row land is the proof that the worker declines;
 * the recipe-origin control, through the same real store and the same seeded event, shows the row WOULD land.
 *
 * The same applies to the memo: `ingredient_resolution_memos` answers for every cook, and a paste proposal must not
 * write to it (the message cannot say the proposal was not a `default`).
 *
 * Real: the verdict store and the band feedback, on a `recipe_app` connection (ADR-0039). Faked: the spend ledger
 * (an ungated stage never touches it), the SSM settings and Bedrock.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { createBandFeedback } from '../../../src/verification/bandFeedback.js';
import { createVerdictStore } from '../../../src/verification/verdictStore.js';
import { processVerification, type VerificationDeps } from '../../../src/handlers/verifyLine.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();

const FOOD_ID = '01JE2EPASTEORIGIN000000000';
/** Unique to this file, so every band row it can cause is countable and removable by this one value. */
const RANKER_VERSION = 'e2e-paste-origin-ranker';
const PHRASE = 'e2e paste origin flour';

const CONTENT = {
    sourceLine: `2 cups ${PHRASE}`,
    ingredientPhrase: PHRASE,
    foodId: FOOD_ID,
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    evidenceKind: 'ranked' as const,
    shortlist: [{ foodId: FOOD_ID, score: 0.9 }],
    requestedAt: '2026-10-25T10:00:00.000Z',
};

const PASTE = {
    ...CONTENT,
    origin: {
        kind: 'parseJob' as const,
        jobId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        lineIndex: 0,
        foodIndex: 0,
    },
};

const RECIPE = { ...CONTENT, origin: { kind: 'recipe' as const, recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' } };

describe('a paste-job line through the gate (LOCAL e2e)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    /**
     * Another cook's SAVED line resolved this food lexically: the event the band store would read.
     *
     * @sideEffect Inserts a binding and its resolution event.
     */
    async function seedSomeoneElsesLexicalResolution(): Promise<void> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO food_lookups (food_id) VALUES ($1) RETURNING id`,
            [FOOD_ID],
        );

        await pool.query(
            `INSERT INTO ingredient_resolutions (food_lookup_id, tier, rung, margin, query_shape, ranker_version)
             VALUES ($1, 'lexical', 'head', 0.4, 'multi-word', $2)`,
            [rows[0]?.id, RANKER_VERSION],
        );
    }

    /** Healthy collaborators around the two real stores. */
    function deps(): VerificationDeps {
        const db = drizzle(pool);

        return {
            stage: 'sandbox',
            deployRegion: 'us-east-1',
            settings: {
                resolve: () => Promise.resolve({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
            },
            ledger: { reserve: vi.fn(), settle: vi.fn() },
            bedrock: {
                converse: () =>
                    Promise.resolve({
                        kind: 'answered' as const,
                        text: '{"verdict":"agree","certainty":"high","reason":"matches"}',
                        stopReason: 'end_turn',
                        usage: { inputTokens: 660, outputTokens: 42, totalTokens: 702 },
                    }),
            },
            store: createVerdictStore(db),
            bands: createBandFeedback(pool),
            emit: () => undefined,
            now: () => new Date('2026-10-25T10:00:01.000Z'),
            claimLeaseSeconds: 60,
            attemptAllowance: 20,
        };
    }

    async function count(query: string, params: unknown[]): Promise<number> {
        const { rows } = await pool.query<{ n: number }>(query, params);

        return rows[0]?.n ?? 0;
    }

    const verdicts = (): Promise<number> =>
        count(`SELECT count(*)::int AS n FROM recipe_ingredient_verifications WHERE food_id = $1`, [FOOD_ID]);
    const observations = (): Promise<number> =>
        count(`SELECT count(*)::int AS n FROM resolution_band_observations WHERE ranker_version = $1`, [
            RANKER_VERSION,
        ]);
    const memos = (): Promise<number> =>
        count(`SELECT count(*)::int AS n FROM ingredient_resolution_memos WHERE source_phrase = $1`, [PHRASE]);

    afterEach(async () => {
        await roleDb.asOwner(async (owner) => {
            await owner.query(`DELETE FROM resolution_band_observations WHERE ranker_version = $1`, [RANKER_VERSION]);
            await owner.query(`DELETE FROM resolution_band_authority WHERE ranker_version = $1`, [RANKER_VERSION]);
            await owner.query(`DELETE FROM ingredient_resolution_memos WHERE source_phrase = $1`, [PHRASE]);
            await owner.query(
                `DELETE FROM recipe_verification_attempts WHERE verification_key IN
                (SELECT verification_key FROM recipe_ingredient_verifications WHERE food_id = $1)`,
                [FOOD_ID],
            );
            await owner.query(`DELETE FROM recipe_ingredient_verifications WHERE food_id = $1`, [FOOD_ID]);
            await owner.query(
                `DELETE FROM ingredient_resolutions WHERE food_lookup_id IN (SELECT id FROM food_lookups WHERE food_id = $1)`,
                [FOOD_ID],
            );
            await owner.query(`DELETE FROM food_lookups WHERE food_id = $1`, [FOOD_ID]);
        });
    });

    afterAll(async () => {
        await pool.end();
    });

    it('⛔ lands the verdict, and NO band observation and NO memo — though both had somewhere to land', async () => {
        await seedSomeoneElsesLexicalResolution();

        await processVerification(deps(), PASTE);

        expect(await verdicts()).toBe(1);
        expect(await observations()).toBe(0);
        expect(await memos()).toBe(0);
    });

    it('the control: the same line from a SAVED recipe files the observation and remembers the phrase', async () => {
        await seedSomeoneElsesLexicalResolution();

        await processVerification(deps(), RECIPE);

        expect(await verdicts()).toBe(1);
        expect(await observations()).toBe(1);
        expect(await memos()).toBe(1);
    });

    it('⛔ the saved line finds the paste verdict already there — one judgement, paid once', async () => {
        const d = deps();
        const converse = vi.spyOn(d.bedrock, 'converse');

        await processVerification(d, PASTE);
        await processVerification(d, RECIPE);

        expect(converse).toHaveBeenCalledTimes(1);
        expect(await verdicts()).toBe(1);
    });
});
