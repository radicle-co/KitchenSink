/**
 * Analytics plan U3 — server-door capture through the BOOTED app, against a real Postgres (SC4, R2, R7).
 *
 * Three properties only this tier can prove:
 *
 * 1. **ISOLATION (SC4).** With the analytics write path forced to fail — and separately to HANG — the
 *    user-facing response is unchanged in status and body and returns promptly. A unit test proves
 *    `capture` swallows; only a real request through the real wiring proves the caller never waited.
 * 2. **EXACTLY ONE event per action, with the verified actor.** A detail GET lands one `recipe_viewed`;
 *    a collection add lands one `recipe_saved`; an idempotent replay of the same add lands NOTHING
 *    (the created-flag rule — replay must not mint 015's credit).
 * 3. **THE CAPTURE-POINT MUTATION TEST.** A rating write and both version reads internally call
 *    `RecipesService.getById` for authorization; they must emit ZERO `recipe_viewed` events. If anyone
 *    "helpfully" moves capture from the controller handler into the service, these scenarios fail —
 *    that placement would permanently inflate every lifetime count 015 consumes.
 *
 * (The photo routes share the same internal call sites but need S3 configuration this harness does not
 * carry; the controller-placement unit tests plus these three HTTP paths cover the same mutation.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { AnalyticsService } from '../../../src/analytics/analytics.service.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JU3SRVCAPTUREOWNER00000A';

/** A second cook — ratings refuse the author's own recipe, so the rating scenario needs a bystander. */
const RATER = '01JU3SRVCAPTURERATER00000B';

/** A seeded catalog row — create's by-food admission refuses an unknown ingredient id. */
const INGREDIENT_ID = '00000000-0000-4000-8000-00000000c4ab';

describe.skipIf(!hasDatabaseUrl)('U3 server-door capture (integration, booted app)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let analytics: AnalyticsService;
    /** The service's REAL private db, restored after every fault-injection scenario. */
    let realAnalyticsDb: unknown;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        analytics = booted.app.get(AnalyticsService);
        realAnalyticsDb = (analytics as unknown as { db: unknown }).db;
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        (analytics as unknown as { db: unknown }).db = realAnalyticsDb;
        await db.execute(sql`DELETE FROM analytics_events WHERE user_id IN (${OWNER}, ${RATER})`);
        await db.execute(sql`
            DELETE FROM recipe_impact_signals
             WHERE recipe_id IN (SELECT id FROM recipes WHERE owner_id = ${OWNER})
        `);
        await db.execute(sql`
            DELETE FROM recipe_collections
             WHERE collection_id IN (SELECT id FROM collections WHERE owner_id = ${OWNER})
        `);
        await db.execute(sql`DELETE FROM collections WHERE owner_id = ${OWNER}`);
        await db.execute(sql`DELETE FROM recipes WHERE owner_id = ${OWNER}`);
        await db.execute(sql`
            INSERT INTO ingredients (id, name, is_user_entered, search_vector)
            VALUES (${INGREDIENT_ID}, 'Capture probe water', true, to_tsvector('english', 'capture probe water'))
            ON CONFLICT (id) DO NOTHING
        `);
    });

    async function createRecipe(): Promise<string> {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Capture probe soup',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [
                    {
                        ingredientId: INGREDIENT_ID,
                        name: 'Water',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'cup',
                    },
                ],
                steps: [{ instruction: 'Boil the water.' }],
            }),
        });

        if (res.status !== 201) {
            throw new Error(`recipe create failed ${res.status}: ${await res.text()}`);
        }

        const bodyJson = (await res.json()) as { id: string };

        return bodyJson.id;
    }

    async function createCollection(): Promise<string> {
        const res = await fetch(`${baseUrl}/api/v1/collections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Capture probe shelf' }),
        });

        expect(res.status).toBe(201);
        const bodyJson = (await res.json()) as { id: string };

        return bodyJson.id;
    }

    async function eventCount(type: string): Promise<number> {
        const result = await db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${OWNER} AND event_type = ${type}
        `);

        return Number(result.rows[0]?.n ?? 0);
    }

    /** Poll for a fire-and-forget write to land (bounded — the row arrives in milliseconds normally). */
    async function waitForEvents(type: string, expected: number): Promise<number> {
        const deadline = Date.now() + 3_000;
        let count = await eventCount(type);

        while (count < expected && Date.now() < deadline) {
            await new Promise((resolve) => {
                setTimeout(resolve, 50);
            });
            count = await eventCount(type);
        }

        return count;
    }

    /** Let any in-flight (unexpected) capture land before asserting a ZERO. */
    async function settle(): Promise<void> {
        await new Promise((resolve) => {
            setTimeout(resolve, 300);
        });
    }

    it('a detail GET lands EXACTLY ONE recipe_viewed with the verified actor — and the fold counts it', async () => {
        const recipeId = await createRecipe();

        const res = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}`);
        expect(res.status).toBe(200);

        expect(await waitForEvents('recipe_viewed', 1)).toBe(1);
        const rows = await db.execute<{ recipe_id: string; user_id: string }>(sql`
            SELECT recipe_id, user_id FROM analytics_events
             WHERE user_id = ${OWNER} AND event_type = 'recipe_viewed'
        `);
        expect(rows.rows[0]?.recipe_id).toBe(recipeId);

        const signal = await db.execute<{ view_count: string }>(sql`
            SELECT view_count FROM recipe_impact_signals WHERE recipe_id = ${recipeId}
        `);
        expect(Number(signal.rows[0]?.view_count)).toBe(1);
    });

    it('a collection add lands ONE recipe_saved; the idempotent replay lands NOTHING (created-flag rule)', async () => {
        const recipeId = await createRecipe();
        const collectionId = await createCollection();

        const add = await fetch(`${baseUrl}/api/v1/collections/${collectionId}/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeId }),
        });
        expect(add.status).toBe(201);
        expect(await waitForEvents('recipe_saved', 1)).toBe(1);

        // The replay: same membership, same 2xx response — and NO second save event to farm credit with.
        const replay = await fetch(`${baseUrl}/api/v1/collections/${collectionId}/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeId }),
        });
        expect(replay.status).toBe(201);
        await settle();
        expect(await eventCount('recipe_saved')).toBe(1);
    });

    it('⛔ SC4: with the analytics db REJECTING, the detail read and the add are byte-for-byte unaffected', async () => {
        const recipeId = await createRecipe();
        const collectionId = await createCollection();
        (analytics as unknown as { db: unknown }).db = {
            execute: () => Promise.reject(new Error('analytics db down')),
        };

        const read = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}`);
        expect(read.status).toBe(200);
        const readBody = (await read.json()) as { id: string; title: string };
        expect(readBody.id).toBe(recipeId);
        expect(readBody.title).toBe('Capture probe soup');

        const add = await fetch(`${baseUrl}/api/v1/collections/${collectionId}/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeId }),
        });
        expect(add.status).toBe(201);

        await settle();
        expect(await eventCount('recipe_viewed')).toBe(0);
        expect(await eventCount('recipe_saved')).toBe(0);
    });

    it('⛔ SC4: with the analytics db HANGING, responses still return promptly — the caller never awaits', async () => {
        const recipeId = await createRecipe();
        (analytics as unknown as { db: unknown }).db = {
            execute: () =>
                new Promise(() => {
                    // never settles — the pathological pool
                }),
        };

        const started = Date.now();
        const read = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}`);
        const elapsed = Date.now() - started;

        expect(read.status).toBe(200);
        // Generous bound: the read itself takes tens of ms; a caller that awaited the hung insert
        // would blow far past this.
        expect(elapsed).toBeLessThan(1_500);
    });

    it('⛔ the capture-point mutation test: a rating write and both version reads emit ZERO recipe_viewed', async () => {
        const recipeId = await createRecipe();
        // Publish it so a second cook can rate it (an author may not rate their own recipe).
        await db.execute(sql`
            UPDATE recipes SET visibility = 'public', status = 'published' WHERE id = ${recipeId}
        `);

        const rate = await asPrincipal(RATER, async () =>
            fetch(`${baseUrl}/api/v1/recipes/${recipeId}/rating`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ stars: 5 }),
            }),
        );
        expect(rate.status).toBe(200);

        const versions = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/versions`);
        expect(versions.status).toBe(200);

        const versionOne = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/versions/1`);
        expect(versionOne.status).toBe(200);

        await settle();
        // Neither the OWNER's version reads nor the RATER's rating write is a detail view.
        expect(await eventCount('recipe_viewed')).toBe(0);
        const raterEvents = await db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${RATER}
        `);
        expect(Number(raterEvents.rows[0]?.n)).toBe(0);
    });
});
