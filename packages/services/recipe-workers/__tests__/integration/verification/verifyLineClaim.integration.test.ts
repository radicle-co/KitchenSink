/**
 * U7 — the verification gate CLAIMS before it spends (R6/R9/R18/R19), against real PostgreSQL.
 *
 * ⛔ WHY THE CLAIM EXISTS. The gate reserved spend, called Bedrock, and only then computed the verification
 * key and recorded what it concluded. Every input to that key comes from the MESSAGE — the source line, the
 * food id, the quantity pair, the unit, the restated measure — so a duplicate delivery could always have
 * been answered for free. It was not, so a redelivery paid the model again to reach a judgement already
 * stored under the very key it could have computed first. On a standard queue a duplicate is ordinary.
 *
 * ⛔ WHY THIS TIER. Every claim predicate is a claim about the DATABASE: that `ON CONFLICT … WHERE`
 * serialises two concurrent duplicates to exactly one winner, that `RETURNING` gives the post-increment
 * count, that a verdict read keyed on the model does NOT match an older model's judgement. This file's
 * sibling `verdictStore.integration.test.ts` exists because a mocked store proved a method was called while
 * every real INSERT failed — twelve billed verdicts lost after Bedrock was paid.
 *
 * Runs against the role-split fixture as `recipe_app` (ADR-0039); skipped when no admin server is configured.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { createVerdictStore } from '../../../src/verification/verdictStore.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const KEY = 'it-verify-claim-key';
const MODEL = 'amazon.nova-micro-v1:0';
const NEWER_MODEL = 'amazon.nova-2-lite-v1:0';
const FOOD_ID = '01M13XKKV183RCVG7NB8T0NFKF';

/** A lease long enough that nothing in a test run ages out of it — the concurrent-duplicate case. */
const LEASE = 600;

describe.skipIf(!hasTestDatabase)('the verification claim (integration)', () => {
    let pool: pg.Pool;
    let store: ReturnType<typeof createVerdictStore>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        store = createVerdictStore(drizzle(pool));
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_verification_attempts WHERE verification_key LIKE '${KEY}%'`);
        await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key LIKE '${KEY}%'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Land a verdict under `modelId`, as a completed verification would. */
    async function landVerdict(modelId: string): Promise<void> {
        await store.recordVerdict({
            verificationKey: KEY,
            verdict: 'agree',
            certainty: 'high',
            band: 'verified',
            aspects: ['identity'],
            modelId,
            foodId: FOOD_ID,
        });
    }

    async function attemptRow(): Promise<{ attempts: number; failure_code: string | null } | undefined> {
        const { rows } = await pool.query(
            `SELECT attempts, failure_code FROM recipe_verification_attempts
              WHERE verification_key = $1 AND model_id = $2`,
            [KEY, MODEL],
        );

        return rows[0] as { attempts: number; failure_code: string | null } | undefined;
    }

    it('a first delivery CLAIMS the attempt', async () => {
        expect(await store.claimVerification(KEY, MODEL, LEASE)).toEqual({ kind: 'claimed', attempts: 1 });
        expect((await attemptRow())?.attempts).toBe(1);
    });

    it('⛔ a duplicate whose verdict already exists claims NOTHING — no reservation, no model call', async () => {
        await landVerdict(MODEL);

        expect(await store.claimVerification(KEY, MODEL, LEASE)).toEqual({ kind: 'already-verified' });
        // No attempt row was written either: there is nothing to count for a line that is already judged.
        expect(await attemptRow()).toBeUndefined();
    });

    /**
     * ⛔ The supersede rule, one table over. `recordVerdict`'s `DO UPDATE` exists so a re-verification under
     * a NEWER model replaces an older judgement rather than being dropped — so the claim's verdict read must
     * be keyed on the model too, or last quarter's answer would suppress this quarter's check forever.
     */
    it('⛔ a verdict from an OLDER model does not suppress re-verification under the current one', async () => {
        await landVerdict(MODEL);

        expect(await store.claimVerification(KEY, NEWER_MODEL, LEASE)).toEqual({ kind: 'claimed', attempts: 1 });
    });

    /**
     * Two deliveries of one line arriving together is ordinary on a standard queue. Serialised on the row by
     * `ON CONFLICT … WHERE`, exactly one wins; the loser completes having reserved nothing.
     */
    it('⛔ two CONCURRENT duplicates produce exactly ONE claim', async () => {
        const [first, second] = await Promise.all([
            store.claimVerification(KEY, MODEL, LEASE),
            store.claimVerification(KEY, MODEL, LEASE),
        ]);

        const kinds = [first?.kind, second?.kind].sort();
        expect(kinds).toEqual(['claimed', 'held']);
        expect((await attemptRow())?.attempts).toBe(1);
    });

    it('a delivery after the lease has lapsed claims again, and the counter advances', async () => {
        await store.claimVerification(KEY, MODEL, LEASE);

        expect(await store.claimVerification(KEY, MODEL, 0)).toEqual({ kind: 'claimed', attempts: 2 });
    });

    /**
     * Giving up is RECORDED, and the line then publishes — which is what an absent verdict has always meant.
     * The difference is that an operator can see the gate gave up rather than inferring it from a line that
     * quietly never got checked.
     */
    it('records why the gate stopped trying, leaving no verdict behind', async () => {
        await store.claimVerification(KEY, MODEL, LEASE);
        await store.recordAttemptFailure(KEY, MODEL, 'attempt_allowance_exhausted');

        expect((await attemptRow())?.failure_code).toBe('attempt_allowance_exhausted');

        const { rows } = await pool.query(`SELECT 1 FROM recipe_ingredient_verifications WHERE verification_key = $1`, [
            KEY,
        ]);
        expect(rows).toHaveLength(0);
    });

    /**
     * ⛔ The bookkeeping retires WITH the judgement, so a counter can never outlive what it was counting —
     * and the next delivery of this line reads the verdict and stops, which is the whole point of the claim.
     */
    it('⛔ recording the verdict CLEARS the attempt row, and the next delivery is answered for free', async () => {
        await store.claimVerification(KEY, MODEL, LEASE);
        await landVerdict(MODEL);

        expect(await attemptRow()).toBeUndefined();
        expect(await store.claimVerification(KEY, MODEL, LEASE)).toEqual({ kind: 'already-verified' });
    });
});
