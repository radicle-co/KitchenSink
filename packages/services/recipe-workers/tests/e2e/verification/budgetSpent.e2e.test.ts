/**
 * A PASTE-MATCH REVIEW THE SPEND CEILING REFUSES, against a real PostgreSQL (ADR-0024 §3; owner ruling 2026-10-26).
 *
 * ⛔ WHAT A MOCK CANNOT SHOW, and why this tier exists for this change: the denial here is REAL. The gate runs on the gated
 * stage with the real ledger and a ceiling below one call's worst case, so `reserve`'s conditional `INSERT … WHERE
 * headroom >= 0` returns zero rows and that IS the denial. Then the real verdict store writes the fact through the
 * production role (`recipe_app`: DML and no DDL), so this also proves migration 0061's column exists, accepts the period,
 * and that the shape CHECK holds. A fake ledger answering `denied` would prove none of that.
 *
 * The stage is a dependency of the handler (`deps.stage`), not an environment: `STAGE=local` is the suite's own, and the
 * gate is injected by passing `prod`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { createSpendLedger } from '../../../src/common/verificationSpend.js';
import { processVerification, type VerificationDeps } from '../../../src/handlers/verifyLine.js';
import { createVerdictStore } from '../../../src/verification/verdictStore.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const FOOD_ID = '01JE2EBUDGETSPENT0000000000';
const PHRASE = 'e2e budget spent flour';
const MODEL = 'amazon.nova-micro-v1:0';

const CONTENT = {
    sourceLine: `2 cups ${PHRASE}`,
    ingredientPhrase: PHRASE,
    foodId: FOOD_ID,
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    evidenceKind: 'curated-exact' as const,
    shortlist: [],
    requestedAt: '2026-10-26T10:00:00.000Z',
};
const PASTE = {
    ...CONTENT,
    origin: { kind: 'parseJob' as const, jobId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', lineIndex: 0, foodIndex: 0 },
};
const RECIPE = { ...CONTENT, origin: { kind: 'recipe' as const, recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' } };

describe('a ceiling denial on a paste-match review (LOCAL e2e)', () => {
    let pool: pg.Pool;
    const converse = vi.fn();

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    /** The gated stage, the real ledger and store, and a ceiling of 1 micro, below any call's worst case. */
    function deps(ceilingMicros: number, now = '2026-10-26T10:00:01.000Z', stage = 'prod'): VerificationDeps {
        const db = drizzle(pool);

        return {
            stage,
            deployRegion: 'us-east-1',
            settings: { resolve: () => Promise.resolve({ ceilingMicros, modelId: MODEL }) },
            ledger: createSpendLedger(db),
            bedrock: { converse },
            store: createVerdictStore(db),
            bands: { record: vi.fn(), authorityFor: vi.fn() },
            emit: () => undefined,
            now: () => new Date(now),
            claimLeaseSeconds: 60,
            attemptAllowance: 20,
        } as unknown as VerificationDeps;
    }

    async function attempts(): Promise<
        { attempts: number; budget_spent_period: string | null; failure_code: string | null }[]
    > {
        const { rows } = await pool.query(
            `SELECT attempts, budget_spent_period, failure_code FROM recipe_verification_attempts
              WHERE model_id = $1`,
            [MODEL],
        );

        return rows;
    }

    const verdicts = async (): Promise<number> =>
        (
            await pool.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM recipe_ingredient_verifications WHERE food_id = $1`,
                [FOOD_ID],
            )
        ).rows[0]?.n ?? 0;

    afterEach(async () => {
        converse.mockReset();
        converse.mockResolvedValue({
            kind: 'answered',
            text: '{"verdict":"agree","certainty":"high","reason":"matches"}',
            stopReason: 'end_turn',
            usage: { inputTokens: 660, outputTokens: 42, totalTokens: 702 },
        });
        await roleDb.asOwner(async (owner) => {
            await owner.query(`DELETE FROM recipe_verification_attempts WHERE model_id = $1`, [MODEL]);
            await owner.query(`DELETE FROM recipe_ingredient_verifications WHERE food_id = $1`, [FOOD_ID]);
            await owner.query(`DELETE FROM verification_spend`);
        });
    });

    afterAll(async () => {
        await pool.end();
    });

    it('⛔ stores the period on the attempt row, writes NO verdict, calls no model, and the message completes', async () => {
        await expect(processVerification(deps(1), PASTE)).resolves.toBeUndefined();

        expect(converse).not.toHaveBeenCalled();
        expect(await verdicts()).toBe(0);
        expect(await attempts()).toStrictEqual([{ attempts: 1, budget_spent_period: '2026-10', failure_code: null }]);
    });

    it('⛔ the period is the one captured at RESERVE: a clock on the last day of the month stores that month', async () => {
        await processVerification(deps(1, '2026-09-30T23:59:59.000Z'), PASTE);

        expect((await attempts())[0]?.budget_spent_period).toBe('2026-09');
    });

    it('⛔ the SAVE path against the same real denial still throws and stores no budget fact', async () => {
        await expect(processVerification(deps(1), RECIPE)).rejects.toThrow(/ceiling reached/u);

        expect((await attempts()).map((row) => row.budget_spent_period)).toStrictEqual([null]);
        expect(await verdicts()).toBe(0);
    });

    it('is idempotent: a redelivery after the lease stores the same fact, once', async () => {
        await processVerification(deps(1), PASTE);
        await roleDb.asOwner((owner) =>
            owner.query(
                `UPDATE recipe_verification_attempts SET last_received_at = now() - interval '1 hour' WHERE model_id = $1`,
                [MODEL],
            ),
        );
        await processVerification(deps(1), PASTE);

        const rows = await attempts();

        expect(rows).toHaveLength(1);
        expect(rows[0]?.budget_spent_period).toBe('2026-10');
    });

    it('a real verdict retires the fact: once the budget is back the attempt row, and the spent period, are gone', async () => {
        await processVerification(deps(1), PASTE);
        await roleDb.asOwner((owner) =>
            owner.query(
                `UPDATE recipe_verification_attempts SET last_received_at = now() - interval '1 hour' WHERE model_id = $1`,
                [MODEL],
            ),
        );

        await processVerification(deps(100_000_000), PASTE);

        expect(converse).toHaveBeenCalledTimes(1);
        expect(await verdicts()).toBe(1);
        expect(await attempts()).toStrictEqual([]);
    });

    it('rejects a malformed period at the database: the shape CHECK holds', async () => {
        await expect(createVerdictStore(drizzle(pool)).recordBudgetSpent('k', MODEL, 'October')).rejects.toThrow();
    });
});
