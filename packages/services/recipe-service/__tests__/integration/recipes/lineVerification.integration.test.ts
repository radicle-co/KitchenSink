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
 * (`ingredients.source_line`, migration 0024 carried into 0051) exists, or that the table itself was ever migrated.
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
 *  4. **The shared binding is UNTOUCHED.** The line's `food_lookups` row reads exactly as it did after a
 *     contradiction, because a verdict about one recipe line must never withdraw nutrition from every other
 *     recipe referencing that food (0023's first reason, blast radius). Only a real database can show that
 *     nothing wrote to it.
 *
 * ⚠️ REWRITTEN (plan 002): the recipe database stores no food names, so the stub now also answers food's
 * `POST /api/v1/foods/refs/resolve` — the line's name AND its live status (the presence overlay reads the status
 * from there). It answers as food does: a private food only to its author, `absent` to anyone else, keyed on the
 * forwarded bearer, which is therefore the owner's (`bearerFor`). The line binds through a `food_lookups` row
 * (`tests/support/lineChain.ts`); the privacy cases set that binding's `food_owner_id`, which is where R20's owner
 * lives since 0051. Case 4 asserted `ingredients.food_resolution_status` on the old catalog row; that column is
 * gone (a binding has no status), so it now asserts the whole binding row is unchanged.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import {
    resolveFoodRefsRequestSchema,
    resolveFoodRefsResponseSchema,
    type FoodRefEntry,
} from '@kitchensink/schema-food';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes } from '../../../src/database/schema/index.js';
import { sha256Hex } from '../../../src/common/sha256.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { ensureFoodLookup, insertIngredientLine } from '../../../tests/support/lineChain.js';
import { recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();

const OWNER = '01JU14VERIFYOWNER00000001';
const RECIPE_ID = '00000000-0000-4000-8000-00000014a001';
const LINE_ID = '00000000-0000-4000-8000-00000014b001';
/** The line's binding — a `food_lookups` id since 0051. */
const CATALOG_ID = '00000000-0000-4000-8000-00000014c001';
const FOOD_ID = '01JFOODU14VERIFYFLOUR00001';
/** Food's name for {@link FOOD_ID}, as its `refs/resolve` answers it. */
const FOOD_NAME = 'U14 Flour';
/** A cook who is not the viewer — the author of the food in the R20 cases. */
const SOMEONE_ELSE = '01JU13SOMEONEELSE00000001';
/** The bearer every request forwards: the dev-auth owner's own. */
const OWNER_BEARER = bearerFor(OWNER);

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

/**
 * The LIVE status the food stub reports for {@link FOOD_ID}, settable per test.
 *
 * ⚠️ Mutable because the live status is the ONLY way to reach `foodPresenceStatus`, and nothing else in this
 * tier can produce a withdrawal: the recipe database persists no food status at all.
 */
let liveFoodStatus: 'RESOLVED' | 'WITHDRAWN' = 'RESOLVED';

/**
 * The author of {@link FOOD_ID} when a case makes it a PRIVATE food, else `undefined`. Set only through
 * `makePrivateTo`, which writes the binding's owner in the same step, so the stub and the database agree.
 */
let foodOwner: string | undefined;

/** The caller a forwarded `Bearer <user id>` names. */
function callerOf(req: IncomingMessage): string | undefined {
    const header = req.headers['authorization'];

    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/** Read and JSON-parse a request body. */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Food's answer about one ref, as food gives it: the flour to anyone, unless it is private to someone other than
 * the caller — then `absent`, the same entry an unknown id gets.
 */
function refEntryFor(ref: FoodRefEntry['ref'], callerId: string | undefined): FoodRefEntry {
    const readable = ref.kind === 'root' && ref.id === FOOD_ID && (foodOwner === undefined || foodOwner === callerId);

    return readable
        ? {
              outcome: 'found',
              ref,
              name: FOOD_NAME,
              status: liveFoodStatus,
              ...(foodOwner === undefined ? {} : { visibility: 'private' as const }),
          }
        : { outcome: 'absent', ref };
}

/** A stub standing in for food's nutrition and `refs/resolve` routes, answering with real nutrition. */
async function startFoodStub(): Promise<{ server: Server; origin: string }> {
    const server = createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/v1/foods/refs/resolve') {
            void bodyOf(req).then((body) => {
                const { refs } = resolveFoodRefsRequestSchema.parse(body);
                const entries = refs.map((ref) => refEntryFor(ref, callerOf(req)));

                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(resolveFoodRefsResponseSchema.parse({ entries })));
            });

            return;
        }

        if ((req.url ?? '').startsWith('/api/v1/foods/nutrition')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({
                    foods: [
                        {
                            id: FOOD_ID,
                            status: liveFoodStatus,
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
    ingredients: { ingredientId: string; name?: string; resolutionStatus?: string }[];
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
    async function recordVerdict(band: string, identityVerdict: string | null = null): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_ingredient_verifications
                 (verification_key, verdict, certainty, band, aspects, identity_verdict, model_id, food_id)
             VALUES ($1, $2, 'high', $3, ARRAY['identity','quantity'], $5, 'test.model', $4)
             ON CONFLICT (verification_key) DO UPDATE
                 SET band = EXCLUDED.band, identity_verdict = EXCLUDED.identity_verdict`,
            [VERDICT_KEY, band === 'contradicted' ? 'disagree' : 'agree', band, FOOD_ID, identityVerdict],
        );
    }

    /** Ask the batch endpoint for this recipe as the dev-auth owner. */
    async function askBatch(): Promise<NutritionBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: OWNER_BEARER },
            body: JSON.stringify({ recipeIds: [RECIPE_ID] }),
        });

        expect(response.status).toBe(200);

        return (await response.json()) as NutritionBody;
    }

    /** Read the recipe detail as the dev-auth owner. */
    async function askDetail(): Promise<DetailBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/${RECIPE_ID}`, {
            headers: { authorization: OWNER_BEARER },
        });

        expect(response.status).toBe(200);

        return (await response.json()) as DetailBody;
    }

    beforeAll(async () => {
        const stub = await startFoodStub();
        foodStub = stub.server;
        process.env['FOOD_SERVICE_URL'] = stub.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);

        await ensureFoodLookup(pool, { arm: 'shared', foodId: FOOD_ID, id: CATALOG_ID });
        // A fresh recipe on every run: a pinned line id left behind by an interrupted run would collide.
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);

        await db.insert(recipes).values({
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
        });

        await insertIngredientLine(pool, {
            id: LINE_ID,
            recipeId: RECIPE_ID,
            foodLookupId: CATALOG_ID,
            quantity: '200',
            unit: 'g',
            // The column migration 0024 added. Without it every line skips the gate, which is exactly why
            // the verdict table shipped write-only.
            sourceLine: SOURCE_LINE,
            sortOrder: 0,
        });
    });

    /**
     * Make {@link FOOD_ID} a PRIVATE food authored by `ownerId`: the binding's owner (R20's fact, 0051) and the
     * stub's answer move together.
     *
     * @sideEffect Updates the fixture binding and the stub's state.
     */
    async function makePrivateTo(ownerId: string): Promise<void> {
        await pool.query('UPDATE food_lookups SET food_owner_id = $2 WHERE id = $1', [CATALOG_ID, ownerId]);
        foodOwner = ownerId;
    }

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key = $1`, [VERDICT_KEY]);
        await pool.query(`DELETE FROM ingredient_resolutions WHERE food_lookup_id = $1`, [CATALOG_ID]);
        // U13: the R20 overlay cases set the privacy fact; every other case expects it clear.
        await pool.query(`UPDATE food_lookups SET food_owner_id = NULL WHERE id = $1`, [CATALOG_ID]);
        foodOwner = undefined;
        liveFoodStatus = 'RESOLVED';
    });

    /**
     * Record a lexical resolution EVENT for the line's binding, exactly as `resolveThroughCascade`
     * does (plan U4) — zero-authority (`band_epoch` null) unless an epoch is given, aged by `ageHours`.
     *
     * @sideEffect Inserts `ingredient_resolutions`.
     */
    async function recordLexicalEvent(
        ageHours: number,
        bandEpoch: string | null = null,
        shortlist: unknown[] = [],
    ): Promise<void> {
        await pool.query(
            `INSERT INTO ingredient_resolutions
                 (food_lookup_id, tier, rung, margin, shortlist, query_shape, ranker_version, band_epoch, created_at)
             VALUES ($1, 'lexical', 'head', 0.4, $4::jsonb, 'multi-word', 'ladder-v2-comma-head', $2,
                     now() - ($3 || ' hours')::interval)`,
            [CATALOG_ID, bandEpoch, String(ageHours), JSON.stringify(shortlist)],
        );
    }

    afterAll(async () => {
        // The line cascades from its recipe; the binding goes last because the line holds it under `RESTRICT`.
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM food_lookups WHERE id = $1', [CATALOG_ID]);
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

    /**
     * The re-pick arm (owner ruling 2026-08-31, U15 report "Owner rulings" §4): a HIGH-certainty IDENTITY
     * contradiction joins the U13 ambiguity-review surface — the same AMBIGUOUS wire member, so both
     * shipped clients pick it up with no change — while nutrition stays withheld. A verdict with no
     * itemized identity (the whole pre-0042 population) keeps the passive NEEDS_REVIEW badge, asserted
     * above, so nothing that existed moves.
     */
    it('⛔ badges an IDENTITY-contradicted line AMBIGUOUS — the re-pick door — and still withholds', async () => {
        await recordVerdict('contradicted', 'disagree');

        const line = (await askDetail()).ingredients[0];

        expect(line?.resolutionStatus).toBe('AMBIGUOUS');
        expect((await askBatch()).nutrition[RECIPE_ID]).toStrictEqual({
            state: 'unaccounted',
            reason: 'verification_disagreement',
        });
    });

    it('keeps NEEDS_REVIEW for a contradiction whose itemized dispute is QUANTITY-ONLY', async () => {
        // identity agreed; a food re-pick cannot fix an amount, so the pick affordance stays shut.
        await recordVerdict('contradicted', 'agree');

        expect((await askDetail()).ingredients[0]?.resolutionStatus).toBe('NEEDS_REVIEW');
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

    it('⛔ leaves the shared BINDING untouched — a line verdict has no catalog blast radius', async () => {
        const bindingRow = async (): Promise<unknown> =>
            (await pool.query(`SELECT row_to_json(l) AS row FROM food_lookups l WHERE id = $1`, [CATALOG_ID])).rows[0];
        const before = await bindingRow();

        await recordVerdict('contradicted');
        await askBatch();
        await askDetail();

        // `food_lookups` is SHARED, one row per `food_id`. Writing a verdict onto it would withdraw nutrition from
        // every recipe in the system referencing this food — 0023's first and independently sufficient reason for
        // keeping verdicts in their own table. The row still names the food on the root arm, and nothing else.
        expect(before).toMatchObject({ row: { food_id: FOOD_ID, unresolved_food_id: null, food_owner_id: null } });
        expect(await bindingRow()).toStrictEqual(before);
    });
    // ── U13: the AMBIGUOUS member (D7/R9) ────────────────────────────────────────────────────────────

    /** Two candidates whose macros AGREE within the gate's tolerance. */
    const AGREEING_SHORTLIST = [
        {
            foodId: FOOD_ID,
            score: 0.9,
            energyKcalPer100g: 364,
            proteinGPer100g: 10,
            fatGPer100g: 1,
            carbohydrateGPer100g: 76,
        },
        {
            foodId: '01JFOODU13OTHER0000000001',
            score: 0.85,
            energyKcalPer100g: 360,
            proteinGPer100g: 10,
            fatGPer100g: 1,
            carbohydrateGPer100g: 75,
        },
    ];
    /** Two candidates that differ MATERIALLY — the pick changes the figure. */
    const SPREAD_SHORTLIST = [
        {
            foodId: FOOD_ID,
            score: 0.9,
            energyKcalPer100g: 364,
            proteinGPer100g: 10,
            fatGPer100g: 1,
            carbohydrateGPer100g: 76,
        },
        {
            foodId: '01JFOODU13OTHER0000000001',
            score: 0.85,
            energyKcalPer100g: 900,
            proteinGPer100g: 0,
            fatGPer100g: 100,
            carbohydrateGPer100g: 0,
        },
    ];

    it('U13: an INCONCLUSIVE verdict over a materially-spread shortlist badges the line AMBIGUOUS — and still publishes (R23)', async () => {
        await recordLexicalEvent(1, null, SPREAD_SHORTLIST);
        await recordVerdict('inconclusive');

        const detail = await askDetail();

        expect(detail.ingredients[0]?.resolutionStatus).toBe('AMBIGUOUS');
        // R23: ambiguity never withholds — the abstention publishes exactly as absence does.
        const batch = await askBatch();

        expect(batch.nutrition[RECIPE_ID]?.state).toBe('known');
    });

    it('U13: the same inconclusive verdict over AGREEING candidates stays quiet — no pick over nothing', async () => {
        await recordLexicalEvent(1, null, AGREEING_SHORTLIST);
        await recordVerdict('inconclusive');

        const detail = await askDetail();

        expect(detail.ingredients[0]?.resolutionStatus).not.toBe('AMBIGUOUS');
    });

    // ── U13: the RESOLVED_UNAVAILABLE overlay (R20) ─────────────────────────────────────────────────

    it('U13: a private food owned by SOMEONE ELSE renders RESOLVED_UNAVAILABLE to this viewer — name-only, never an error', async () => {
        await makePrivateTo(SOMEONE_ELSE);

        const detail = await askDetail();

        expect(detail.ingredients[0]?.resolutionStatus).toBe('RESOLVED_UNAVAILABLE');
        // Name-only now means NO name: a stranger is never shown another cook's private food name (plan 002 R9).
        expect(detail.ingredients[0]).not.toHaveProperty('name');
    });

    it("U13: the food's OWN author sees the underlying status untouched", async () => {
        await makePrivateTo(OWNER);
        await recordVerdict('contradicted');

        const detail = await askDetail();

        expect(detail.ingredients[0]?.resolutionStatus).toBe('NEEDS_REVIEW');
        // The positive control for the stranger case above: the author IS shown the name.
        expect(detail.ingredients[0]?.name).toBe(FOOD_NAME);
    });

    it('U13: the overlay OUTRANKS the actionable states for a stranger — no pick affordance against an inaccessible food', async () => {
        await makePrivateTo(SOMEONE_ELSE);
        await recordVerdict('contradicted');

        const detail = await askDetail();

        expect(detail.ingredients[0]?.resolutionStatus).toBe('RESOLVED_UNAVAILABLE');
    });

    /**
     * ⛔ THE PRIVACY ANSWER OUTRANKS THE FACTUAL ONE, and this is the only test at any tier that asserts it.
     *
     * `RecipeDetailAssembler` (`recipeDetail.assembler.ts`) composes the three overlays as
     * `viewerLineStatus(foodPresenceStatus(resolveLineStatus(…), liveStatus), owner, viewer)` and its comment
     * rules that presence must run BEFORE the viewer overlay, because `RESOLVED_UNAVAILABLE` is a PRIVACY
     * answer ("this viewer is not served the details") and must never be rewritten into `FOOD_REMOVED`, a
     * FACTUAL claim about a food the viewer is not entitled to know anything about.
     *
     * ⚠️ The three functions' unit tests pin each one, and `viewerLineStatus`-last relative to
     * `resolveLineStatus` — but only a food-side answer driven together with the privacy fact reaches the
     * presence-vs-viewer half of the composition. Inverting the two would leak, to a stranger, that a private
     * food they cannot see is gone.
     *
     * ⚠️ REWRITTEN (plan 002): presence is now read from food's `refs/resolve`, which answers a STRANGER `absent`
     * for another cook's private food whatever its status — so the stranger's presence here is `gone`, not
     * `withdrawn`. Both map to `FOOD_REMOVED` in `foodPresenceStatus`, so inverting the composition still turns
     * this into `FOOD_REMOVED`, and the assertion still catches it.
     */
    it('⛔ U13: a WITHDRAWN private food owned by someone else still renders the PRIVACY answer, not FOOD_REMOVED', async () => {
        await makePrivateTo(SOMEONE_ELSE);
        liveFoodStatus = 'WITHDRAWN';

        const detail = await askDetail();

        expect(detail.ingredients[0]?.resolutionStatus).toBe('RESOLVED_UNAVAILABLE');
        // ⛔ The factual claim must not surface: it names a food this viewer may not know exists.
        expect(detail.ingredients[0]?.resolutionStatus).not.toBe('FOOD_REMOVED');
    });
});
