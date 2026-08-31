/**
 * U14 — A GATE VERDICT REACHES A COOK, end to end: a real booted app, a real Postgres carrying migrations
 * 0023 and 0024, a real `recipe_ingredient_verifications` row, and a real HTTP round trip to a stubbed food
 * origin that ANSWERS.
 *
 * ## ⛔ WHY THIS TIER IS NOT OPTIONAL HERE
 *
 * The join this unit adds is a CONTENT KEY: a digest over `[version, normalizedLine, foodId, quantityLow,
 * quantityHigh, unit]`, computed in this service and computed independently by `recipe-workers` when it
 * writes the row. A unit test with a fake DAL proves the service asks for whatever key it computed — it
 * cannot prove that key matches a row a real writer stored, that the column the line reads from
 * (`recipe_ingredients.source_line`, migration 0024) exists, or that the table itself was ever migrated.
 * And every one of those failures is SILENT: a key that matches nothing reads as "no verdict", and absence
 * of a verdict means PUBLISH, so a broken join looks exactly like a healthy system with nothing to report.
 *
 * ## What is asserted, and why each is load-bearing
 *
 *  1. **A `contradicted` row WITHHOLDS the figure**, and the recipe reports `verification_disagreement` —
 *     the fourth reason — while the food origin answered `200` with real nutrition. This is the whole point:
 *     the withheld state must be distinguishable from an outage, not collapsed into `food_unavailable`.
 *  2. **A `verified` row publishes**, and so does NO row at all. Only an explicit contradiction withholds;
 *     migration 0023's header makes that the read-side contract for an asynchronous gate.
 *  3. **The detail read badges the line `NEEDS_REVIEW`** — the same verdict, surfaced per LINE rather than
 *     per recipe, which is what a cook actually looks at.
 *  4. **The catalog row is UNTOUCHED.** `ingredients.food_resolution_status` still reads `RESOLVED` after a
 *     contradiction, because a verdict about one recipe line must never withdraw nutrition from every other
 *     recipe referencing that food (0023's first reason, blast radius). Only a real database can show that
 *     nothing wrote to that column.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { ingredients, recipeIngredients, recipes } from '../../../src/database/schema/index.js';
import { sha256Hex } from '../../../src/common/sha256.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JU14VERIFYOWNER00000001';
const RECIPE_ID = '00000000-0000-4000-8000-00000014a001';
const LINE_ID = '00000000-0000-4000-8000-00000014b001';
const CATALOG_ID = '00000000-0000-4000-8000-00000014c001';
const FOOD_ID = '01JFOODU14VERIFYFLOUR00001';

/** The raw line the cook's source stated — what migration 0024 admits, and what the gate judges against. */
const SOURCE_LINE = '200 g of plain flour, sifted';

/**
 * The key a verdict about this line is stored under, derived exactly as BOTH sides derive it.
 *
 * ⛔ Hand-writing a digest here would defeat the test: the property under examination is that the service's
 * derivation and the writer's derivation agree, so both must go through `verificationKey`.
 */
const VERDICT_KEY = verificationKey(
    { sourceLine: SOURCE_LINE, foodId: FOOD_ID, quantityLow: 200, quantityHigh: null, unit: 'g', statedMeasure: null },
    sha256Hex,
);

/** A stub standing in for food's `GET /api/v1/foods/nutrition`, always answering with real nutrition. */
async function startFoodStub(): Promise<{ server: Server; origin: string }> {
    const server = createServer((req, res) => {
        if ((req.url ?? '').startsWith('/api/v1/foods/nutrition')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({
                    foods: [
                        {
                            id: FOOD_ID,
                            status: 'RESOLVED',
                            caloriesPer100g: 350,
                            proteinGPer100g: 12,
                            carbsGPer100g: 70,
                            fatGPer100g: 2,
                            portions: [],
                        },
                    ],
                    unknownIds: [],
                }),
            );

            return;
        }

        res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** One recipe's nutrition state as the batch endpoint carries it. */
interface NutritionBody {
    nutrition: Record<string, { state: string; reason?: string; caloriesPerServing?: number }>;
}

/** The detail body, narrowed to the ingredient line's own status. */
interface DetailBody {
    ingredients: { ingredientId: string; resolutionStatus?: string }[];
}

describe.skipIf(!hasDatabaseUrl)('U14 — a verification verdict reaches the cook (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let foodStub: Server;

    /**
     * Store a verdict for {@link VERDICT_KEY}, exactly as `recipe-workers`' `verdictStore` does.
     *
     * @sideEffect Upserts `recipe_ingredient_verifications`.
     */
    async function recordVerdict(band: string): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_ingredient_verifications
                 (verification_key, verdict, certainty, band, aspects, model_id, food_id)
             VALUES ($1, $2, 'high', $3, ARRAY['identity','quantity'], 'test.model', $4)
             ON CONFLICT (verification_key) DO UPDATE SET band = EXCLUDED.band`,
            [VERDICT_KEY, band === 'contradicted' ? 'disagree' : 'agree', band, FOOD_ID],
        );
    }

    /** Ask the batch endpoint for this recipe as the dev-auth owner. */
    async function askBatch(): Promise<NutritionBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer integration-caller-token' },
            body: JSON.stringify({ recipeIds: [RECIPE_ID] }),
        });

        expect(response.status).toBe(200);

        return (await response.json()) as NutritionBody;
    }

    /** Read the recipe detail as the dev-auth owner. */
    async function askDetail(): Promise<DetailBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/${RECIPE_ID}`, {
            headers: { authorization: 'Bearer integration-caller-token' },
        });

        expect(response.status).toBe(200);

        return (await response.json()) as DetailBody;
    }

    beforeAll(async () => {
        const stub = await startFoodStub();
        foodStub = stub.server;
        process.env['FOOD_SERVICE_URL'] = stub.origin;

        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);

        await db
            .insert(ingredients)
            .values({ id: CATALOG_ID, name: 'U14 Flour', foodId: FOOD_ID, foodResolutionStatus: 'RESOLVED' })
            .onConflictDoNothing();

        await db
            .insert(recipes)
            .values({
                id: RECIPE_ID,
                ownerId: OWNER,
                title: 'U14 verification recipe',
                visibility: 'private',
                status: 'published',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                tags: [],
                dietaryFlags: [],
                ingredientNamesText: '',
            })
            .onConflictDoNothing();

        await db
            .insert(recipeIngredients)
            .values({
                id: LINE_ID,
                recipeId: RECIPE_ID,
                ingredientId: CATALOG_ID,
                ingredientName: 'U14 Flour',
                quantity: '200',
                unit: 'g',
                // The column migration 0024 added. Without it every line skips the gate, which is exactly why
                // the verdict table shipped write-only.
                sourceLine: SOURCE_LINE,
                sortOrder: 0,
                isUserEntered: false,
            })
            .onConflictDoNothing();
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key = $1`, [VERDICT_KEY]);
        await pool.query(`DELETE FROM ingredient_resolutions WHERE ingredient_id = $1`, [CATALOG_ID]);
    });

    /**
     * Record a lexical resolution EVENT for the line's ingredient, exactly as `resolveThroughCascade`
     * does (plan U4) — zero-authority (`band_epoch` null) unless an epoch is given, aged by `ageHours`.
     *
     * @sideEffect Inserts `ingredient_resolutions`.
     */
    async function recordLexicalEvent(ageHours: number, bandEpoch: string | null = null): Promise<void> {
        await pool.query(
            `INSERT INTO ingredient_resolutions
                 (ingredient_id, tier, rung, margin, shortlist, query_shape, ranker_version, band_epoch, created_at)
             VALUES ($1, 'lexical', 'head', 0.4, '[]'::jsonb, 'multi-word', 'ladder-v2-comma-head', $2,
                     now() - ($3 || ' hours')::interval)`,
            [CATALOG_ID, bandEpoch, String(ageHours)],
        );
    }

    afterAll(async () => {
        await pool.end();
        await booted.close();
        await new Promise<void>((resolve) => foodStub.close(() => resolve()));
    });

    it('publishes the figure when the gate has judged NOTHING — absence of a verdict means publish', async () => {
        // 200 g at 350 kcal/100 g = 700 kcal, ÷ 2 servings = 350. This is the pre-gate behaviour, and it is
        // the baseline the two cases below are measured against.
        expect((await askBatch()).nutrition[RECIPE_ID]).toMatchObject({ state: 'known', caloriesPerServing: 350 });
    });

    it('publishes the figure when the gate AGREED', async () => {
        await recordVerdict('verified');

        expect((await askBatch()).nutrition[RECIPE_ID]).toMatchObject({ state: 'known', caloriesPerServing: 350 });
    });

    it('⛔ WITHHOLDS the figure and reports `verification_disagreement` when the gate CONTRADICTED it', async () => {
        await recordVerdict('contradicted');

        // Not `food_unavailable`: the stub answered 200 with real per-100g nutrition on this very request.
        // That is the conflation this reason exists to prevent — "try again shortly" about an answer that
        // will not change.
        expect((await askBatch()).nutrition[RECIPE_ID]).toStrictEqual({
            state: 'unaccounted',
            reason: 'verification_disagreement',
        });
    });

    it('⛔ badges the LINE `NEEDS_REVIEW` on the detail read, so a cook sees WHICH line is doubted', async () => {
        await recordVerdict('contradicted');

        const line = (await askDetail()).ingredients.find((entry) => entry.ingredientId === CATALOG_ID);

        expect(line?.resolutionStatus).toBe('NEEDS_REVIEW');
    });

    it('reports the CATALOG mirror status on a line the gate did not contradict', async () => {
        await recordVerdict('verified');

        const line = (await askDetail()).ingredients.find((entry) => entry.ingredientId === CATALOG_ID);

        expect(line?.resolutionStatus).toBe('RESOLVED');
    });

    it('⛔ KTD-A (plan U4c): a fresh zero-authority LEXICAL bind renders PENDING and withholds the figure', async () => {
        await recordLexicalEvent(1);

        // The stub answered with real nutrition, the catalog row is RESOLVED — the withholding is OURS,
        // and the reason says so: "we have not finished checking", never an outage or a data gap.
        expect((await askBatch()).nutrition[RECIPE_ID]).toStrictEqual({
            state: 'unaccounted',
            reason: 'verification_pending',
        });

        const line = (await askDetail()).ingredients.find((entry) => entry.ingredientId === CATALOG_ID);
        expect(line?.resolutionStatus).toBe('PENDING_VERIFICATION');
    });

    it('KTD-A: the VERDICT LANDING flips a pending line to published with no write anywhere', async () => {
        await recordLexicalEvent(1);
        await recordVerdict('verified');

        expect((await askBatch()).nutrition[RECIPE_ID]).toMatchObject({ state: 'known', caloriesPerServing: 350 });

        const line = (await askDetail()).ingredients.find((entry) => entry.ingredientId === CATALOG_ID);
        expect(line?.resolutionStatus).toBe('RESOLVED');
    });

    it('KTD-A: past the age bound the line adopts the actionable NEEDS_REVIEW treatment — still withheld', async () => {
        await recordLexicalEvent(100);

        expect((await askBatch()).nutrition[RECIPE_ID]).toStrictEqual({
            state: 'unaccounted',
            reason: 'verification_pending',
        });

        const line = (await askDetail()).ingredients.find((entry) => entry.ingredientId === CATALOG_ID);
        expect(line?.resolutionStatus).toBe('NEEDS_REVIEW');
    });

    it("KTD-A: an AUTHORIZED-band bind (non-null epoch) publishes instantly — earned autonomy's payoff", async () => {
        await recordLexicalEvent(1, '2');

        expect((await askBatch()).nutrition[RECIPE_ID]).toMatchObject({ state: 'known', caloriesPerServing: 350 });
    });

    it('⛔ leaves `ingredients.food_resolution_status` UNTOUCHED — a line verdict has no catalog blast radius', async () => {
        await recordVerdict('contradicted');
        await askBatch();
        await askDetail();

        const { rows } = await pool.query<{ food_resolution_status: string | null }>(
            `SELECT food_resolution_status FROM ingredients WHERE id = $1`,
            [CATALOG_ID],
        );

        // `ingredients` is a SHARED, ownerless catalog deduped one row per `food_id`. Writing a verdict here
        // would withdraw nutrition from every recipe in the system referencing this food — 0023's first and
        // independently sufficient reason for keeping verdicts in their own table.
        expect(rows[0]?.food_resolution_status).toBe('RESOLVED');
    });
});
