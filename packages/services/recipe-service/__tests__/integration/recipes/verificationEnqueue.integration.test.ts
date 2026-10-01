/**
 * U11 / ADR-0024 — THE VERIFICATION GATE'S PRODUCER, over real HTTP, a real PostgreSQL and a real SQS.
 *
 * ## Why this tier is mandatory, and what a unit test structurally cannot prove here
 *
 * `src/recipes/domain/__tests__/verificationRequests.test.ts` exhausts WHICH lines are asked about, and
 * `src/recipes/__tests__/verificationEnqueue.service.test.ts` pins the orchestration against a fake port.
 * Neither can establish any of the following, and every one of them is a way this ships broken behind a
 * green unit suite:
 *
 *  1. **That the message SQS accepts is the message the worker can parse.** The producer and the consumer
 *     live in different packages and deploy separately (ADR-0022 orders the consumer first). A shape that
 *     does not satisfy `verifyIngredientLineMessageSchema` is POISON: it drains to a DLQ that holds a cook's
 *     recipe text for three days and verifies nothing. This suite therefore re-parses what it RECEIVES with
 *     the consumer's own schema, after a real JSON round trip through a real queue.
 *  2. **That `foodId` is the FOOD-service id and not the catalog row's own uuid.** Both are opaque strings
 *     that satisfy every type in the chain; a fake catalog cannot tell them apart, and getting it wrong would
 *     ask the model to judge identity against an id food-service has never heard of.
 *  3. **That the source line survives the five layers between the wire and the producer** — the validation
 *     pipe (which STRIPS unknown keys silently), `resolveIngredientLines`, the drizzle insert, the read back,
 *     and the projection — and that migration `0024_ingredient_source_line.sql` actually applied.
 *  4. **That a metadata edit re-sending identical lines asks NOTHING.** `replaceForRecipe` deletes and
 *     re-inserts every ingredient row on every save, and both shipped clients send `ingredients` on every
 *     save, so this is the property that decides whether renaming a recipe re-pays for all of it. It is
 *     produced by rows read back out of Postgres, which no unit test observes.
 *
 * ⚠️ The binding this suite uses is created HERE rather than taken from the seed: every seeded binding is on
 * the `author_declared` arm with no `food_id`, which is precisely the case the producer must SKIP — so a suite
 * built on the seed would assert nothing and look thorough.
 *
 * ⚠️ REWRITTEN (plan 002): the recipe database stores no food names, so the name the gate is asked to judge
 * identity against now comes from food-service's `refs/resolve` at save time — served here by the in-process
 * fake (`tests/support/foodFake.ts`), which is why the fake is booted before the app and every write carries the
 * owner's bearer (the service asks food nothing without one). The binding is a
 * `food_lookups` row (`tests/support/lineChain.ts`), the line table is `ingredients`, and request lines carry
 * no `name`. The assertions are unchanged: the message still names the FOOD-service id and FOOD's name.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
    DeleteMessageCommand,
    ReceiveMessageCommand,
    SQSClient,
    type Message as SqsMessage,
} from '@aws-sdk/client-sqs';
import { verifyIngredientLineMessageSchema } from '@kitchensink/recipe-core/resolution/verification-message';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_VERIFICATION_QUEUE_URL } from '../../../tests/globalSetup.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { ensureFoodLookup } from '../../../tests/support/lineChain.js';
import { recipeDb } from '../../../tests/support/roleDb.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JQ8N2X4RBV6WK3ZT5Y7A9C0P';

/** A FOOD-BACKED binding (`food_lookups` id), created by this suite — the seeded bindings are all declared. */
const FOOD_BACKED_INGREDIENT_ID = '00000000-0000-4000-8000-00000011ab01';

/** The opaque food-service id that row points at. Deliberately unlike the ingredient uuid above. */
const FOOD_ID = '01JVERIFYFOOD0000000000001';

/** Food's canonical name, as its `refs/resolve` answers it — what the model is asked to judge identity against. */
const FOOD_NAME = 'Flour, wheat, all-purpose, enriched, bleached';

/** A source line unlike anything the service would RENDER for this food, so a circular check would show. */
const SOURCE_LINE = '2 heaping cups of well-sifted pastry flour, plus more for dusting';

const roleDb = recipeDb();

/**
 * The headers every write sends. The bearer is load-bearing: the service forwards the caller's own credential to
 * food and asks nothing without one, so a save with no bearer could name no food and would ask the gate nothing.
 */
const JSON_AS_OWNER = { 'content-type': 'application/json', authorization: bearerFor(OWNER) };

interface RecipeBody {
    id: string;
    currentVersion: number;
}

describe.skipIf(!hasDatabaseUrl)('the verification gate’s producer (U11 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let sqs: SQSClient;
    let food: FoodFake;

    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(FOOD_ID, { name: FOOD_NAME, status: 'RESOLVED' });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        // A food-BACKED binding. Idempotent, so a re-run is a no-op.
        await ensureFoodLookup(pool, { arm: 'shared', foodId: FOOD_ID, id: FOOD_BACKED_INGREDIENT_ID });

        // Messages another suite left behind would be counted as this suite's.
        await drainQueue();
    });

    afterEach(async () => {
        // Every assertion below is "exactly N messages", which is only meaningful against a known-empty queue.
        await drainQueue();
    });

    afterAll(async () => {
        sqs?.destroy();
        // Lines cascade from their recipes; the binding goes last because a line holds it under `RESTRICT`.
        await pool?.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await pool?.query('DELETE FROM food_lookups WHERE id = $1', [FOOD_BACKED_INGREDIENT_ID]);
        await pool?.end();
        await booted?.close();
        await food?.close();
        delete process.env['FOOD_SERVICE_URL'];
    });

    /** Receive and delete every message currently on the verification queue, returning their bodies. */
    async function drainQueue(): Promise<string[]> {
        const bodies: string[] = [];

        for (;;) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SEED_VERIFICATION_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    // Short-poll would return an empty page while messages are still in flight on a
                    // distributed queue; one second of long-poll is what makes "the queue is empty" mean it.
                    WaitTimeSeconds: 1,
                }),
            );
            const messages: SqsMessage[] = received.Messages ?? [];

            if (messages.length === 0) {
                return bodies;
            }

            for (const message of messages) {
                if (message.Body !== undefined) {
                    bodies.push(message.Body);
                }

                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: SEED_VERIFICATION_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        }
    }

    /** A create body with one food-backed line, optionally transcribed from a source. */
    const createBody = (sourceLine?: string): Record<string, unknown> => ({
        title: `U11 producer ${Date.now()}-${Math.random()}`,
        description: 'Created by the U11 producer spec.',
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        ingredients: [
            {
                ingredientId: FOOD_BACKED_INGREDIENT_ID,
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                ...(sourceLine === undefined ? {} : { sourceLine }),
            },
        ],
        steps: [{ instruction: 'Combine.' }],
    });

    async function create(sourceLine?: string): Promise<RecipeBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: JSON_AS_OWNER,
            body: JSON.stringify(createBody(sourceLine)),
        });

        expect(response.status).toBe(201);

        return (await response.json()) as RecipeBody;
    }

    it('⛔ sends a message the CONSUMER’s own schema accepts, after a real JSON round trip', async () => {
        const created = await create(SOURCE_LINE);
        const bodies = await drainQueue();

        expect(bodies).toHaveLength(1);

        // The whole point of this assertion: `verifyIngredientLineMessageSchema` is what `verifyLine.ts`
        // parses every record with. If this throws, every message the producer sends is poison and the gate
        // silently drains to its DLQ while the API reports success.
        const parsed = verifyIngredientLineMessageSchema.parse(JSON.parse(bodies[0] ?? '{}'));

        expect(parsed.recipeId).toBe(created.id);
        expect(parsed.sourceLine).toBe(SOURCE_LINE);
        expect(parsed.quantityLow).toBe(2);
        expect(parsed.quantityHigh).toBeNull();
        expect(parsed.unit).toBe('cup');
        expect(parsed.evidenceKind).toBe('unattributed');
        expect(parsed.shortlist).toEqual([]);
    });

    it('⛔ names the FOOD-service id and the catalog’s canonical name — not the ingredient row', async () => {
        // Both are opaque strings that satisfy every type in the chain, so only a real catalog row with two
        // DIFFERENT ids can prove which one travelled. Asking the model about an ingredient uuid would have
        // it judge identity against a value food-service has never seen.
        await create(SOURCE_LINE);
        const [body] = await drainQueue();
        const parsed = verifyIngredientLineMessageSchema.parse(JSON.parse(body ?? '{}'));

        expect(parsed.foodId).toBe(FOOD_ID);
        expect(parsed.foodId).not.toBe(FOOD_BACKED_INGREDIENT_ID);
        // FOOD's name, never anything the caller sent — checking our rendering against itself agrees by
        // construction and would report a 100% agreement rate while verifying nothing.
        expect(parsed.candidateFoodName).toBe(FOOD_NAME);
    });

    it('sends NOTHING for a recipe the cook authored rather than transcribed', async () => {
        await create();

        expect(await drainQueue()).toEqual([]);
    });

    it('⛔ asks NOTHING on a metadata edit that re-sends identical lines', async () => {
        // The cost property. `replaceForRecipe` rewrites every ingredient row on every save, and both
        // shipped clients send `ingredients` on every save — so without the already-requested filter a
        // one-word title edit re-pays for every line in the recipe, forever, on every save.
        const created = await create(SOURCE_LINE);

        expect(await drainQueue()).toHaveLength(1);

        const response = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: JSON_AS_OWNER,
            body: JSON.stringify({
                expectedVersion: created.currentVersion,
                title: 'A renamed recipe',
                ingredients: createBody()['ingredients'],
            }),
        });

        expect(response.status).toBe(200);
        expect(await drainQueue()).toEqual([]);
    });

    it('⛔ asks NOTHING when the author OVERRODE our parse — against the REAL carry-forward', async () => {
        // ⚠️ The unit tier asserts this against a FAKE DAL, which means it asserts an assumption about what
        // `replaceForRecipe` persists. Only this tier proves it: the quantity edit moves
        // `[ingredientId, quantity, unit]`, `carryForwardSourceLines` drops the transcription, the column
        // really goes NULL, and the producer — which reads the PERSISTED rows — then has nothing to ask.
        //
        // That is the correct outcome, not a gap: carrying the transcription would have the gate check our
        // parse of `3 cups` against a source that said `2 cups` and correctly DISAGREE with an edit the
        // author made on purpose — the wrong-disagree direction U11 calls unacceptable, on the one line a
        // human has just told us we got wrong.
        const created = await create(SOURCE_LINE);

        expect(await drainQueue()).toHaveLength(1);

        const response = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: JSON_AS_OWNER,
            body: JSON.stringify({
                expectedVersion: created.currentVersion,
                ingredients: [
                    {
                        ingredientId: FOOD_BACKED_INGREDIENT_ID,
                        quantity: { kind: 'exact', value: 3 },
                        unit: 'cup',
                    },
                ],
            }),
        });

        expect(response.status).toBe(200);
        expect(await drainQueue()).toEqual([]);

        const { rows } = await pool.query<{ source_line: string | null }>(
            'SELECT source_line FROM ingredients WHERE recipe_id = $1',
            [created.id],
        );

        // The mechanism, asserted rather than inferred from the empty queue.
        expect(rows[0]?.source_line).toBeNull();
    });

    it('sends NOTHING for a USER-ENTERED line, which has no catalog identity to check', async () => {
        // The seeded bindings are all author-declared (no `food_id`), which is exactly the skip case.
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: JSON_AS_OWNER,
            body: JSON.stringify({
                ...createBody(SOURCE_LINE),
                ingredients: [
                    {
                        // The seeded, unattached `Flour` binding — author-declared, no `food_id`.
                        ingredientId: '00000000-0000-4000-8000-0000000000aa',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cup',
                        sourceLine: SOURCE_LINE,
                    },
                ],
            }),
        });

        expect(response.status).toBe(201);
        expect(await drainQueue()).toEqual([]);
    });
});
