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
 * ⚠️ The catalog row this suite uses is created HERE rather than taken from the seed: every seeded
 * ingredient is `is_user_entered = true` with no `food_id`, which is precisely the case the producer must
 * SKIP — so a suite built on the seed would assert nothing and look thorough.
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

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JU11VERIFY0WNER00000000A';

/** A FOOD-BACKED catalog row, created by this suite — the seeded ingredients are all user-entered. */
const FOOD_BACKED_INGREDIENT_ID = '00000000-0000-4000-8000-00000011ab01';

/** The opaque food-service id that row points at. Deliberately unlike the ingredient uuid above. */
const FOOD_ID = '01JVERIFYFOOD0000000000001';

/** The catalog's canonical name — what the model is asked to judge identity against. */
const FOOD_NAME = 'Flour, wheat, all-purpose, enriched, bleached';

/** A source line unlike anything the service would RENDER for this food, so a circular check would show. */
const SOURCE_LINE = '2 heaping cups of well-sifted pastry flour, plus more for dusting';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

interface RecipeBody {
    id: string;
    currentVersion: number;
}

describe.skipIf(!hasDatabaseUrl)('the verification gate’s producer (U11 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let sqs: SQSClient;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        sqs = new SQSClient({
            endpoint: process.env['SQS_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        // A food-BACKED catalog row. `ON CONFLICT DO NOTHING` so a re-run is a no-op.
        await pool.query(
            `INSERT INTO ingredients (id, name, food_id, food_resolution_status, is_user_entered)
             VALUES ($1, $2, $3, 'RESOLVED', false)
             ON CONFLICT (id) DO NOTHING`,
            [FOOD_BACKED_INGREDIENT_ID, FOOD_NAME, FOOD_ID],
        );

        // Messages another suite left behind would be counted as this suite's.
        await drainQueue();
    });

    afterEach(async () => {
        // Every assertion below is "exactly N messages", which is only meaningful against a known-empty queue.
        await drainQueue();
    });

    afterAll(async () => {
        sqs?.destroy();
        await pool?.end();
        await booted?.close();
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
                name: 'Flour',
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
            headers: { 'content-type': 'application/json' },
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
        // The CATALOG's name, never the caller's `name: 'Flour'` — checking our rendering against itself
        // agrees by construction and would report a 100% agreement rate while verifying nothing.
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
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                expectedVersion: created.currentVersion,
                title: 'A renamed recipe',
                ingredients: createBody()['ingredients'],
            }),
        });

        expect(response.status).toBe(200);
        expect(await drainQueue()).toEqual([]);
    });

    it('sends NOTHING for a USER-ENTERED line, which has no catalog identity to check', async () => {
        // The seeded catalog is entirely user-entered (`food_id IS NULL`), which is exactly the skip case.
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...createBody(SOURCE_LINE),
                ingredients: [
                    {
                        // The seeded, unattached `Flour` row — `is_user_entered = true`, no `food_id`.
                        ingredientId: '00000000-0000-4000-8000-0000000000aa',
                        name: 'Flour',
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
