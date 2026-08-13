/**
 * CR-001 / FR-013 — the rating WRITE path (`PUT`/`DELETE /api/v1/recipes/{id}/rating`) end to end against the
 * REAL booted Nest app + Docker Postgres. Where the sibling `aggregate-trigger` spec proves the trigger
 * in isolation via raw SQL, this proves the whole write path: the DAL upsert/delete, the authorization
 * (visibility + own-recipe), and — the crux — that a `PUT` re-reads and returns the recipe with its
 * trigger-refreshed `averageRating` / `ratingCount`, so the aggregate the client sees is DB-derived
 * through the actual write path, not application arithmetic.
 *
 * The booted app authenticates as a single dev user (the RATER). Recipes owned by OTHER users (and the
 * rater's own) are seeded via a direct pg pool with controlled `owner_id` / `visibility`, so all four
 * authorization branches are reachable from one booted app. Uses the throwaway harness DB; skips when it
 * is not configured.
 *
 * Mutation map (each assertion pins a way the write path could be subtly wrong):
 *   - PUT not re-reading after the trigger → the refreshed-aggregate assertions fail.
 *   - re-rate inserting a second row → ratingCount would be 2, not 1.
 *   - unseeable recipe answered 403 instead of 404 → the IDOR-boundary assertion fails (the leak).
 *   - own-recipe check dropped → the 403 assertion fails (an owner could rate their own).
 *   - DELETE not firing the trigger → the reset-to-unrated assertion fails.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The dev-bypass caller this suite rates as (the RATER — owns none of the seeded "other" recipes). */
const RATER = '01JRATEWRITE00CALLER00000A';
/** A distinct recipe owner (someone else) + a distinct second rater used to prove multi-rating averages. */
const OTHER_OWNER = '01JRATEWRITE000OWNER00000B';
const SECOND_RATER = '01JRATEWRITE00RATER2000000C';

interface RecipeDetailBody {
    id: string;
    ownerId: string;
    ratingCount: number;
    averageRating?: number;
    // Detail-only fields — asserting their presence proves the response is a full RecipeDetail.
    ingredients: unknown[];
    steps: unknown[];
    photos: unknown[];
    nutrition: unknown;
}

interface ErrorBody {
    code: string;
    message: string;
}

describe.skipIf(!hasDatabaseUrl)('rating write path (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: RATER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    });

    afterEach(async () => {
        // Ratings cascade with their recipe; clear this suite's recipes (by the owners it uses) + strays.
        await pool.query('DELETE FROM recipe_ratings WHERE user_id = ANY($1)', [[RATER, SECOND_RATER]]);
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[OTHER_OWNER, RATER]]);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    /** Seed a recipe with a controlled owner + visibility, returning its id. */
    async function seedRecipe(ownerId: string, visibility: 'public' | 'private', title: string): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, $3, 2, 5, 10, 15) RETURNING id`,
            [ownerId, title, visibility],
        );

        return rows[0]!.id;
    }

    async function putRating(id: string, stars: number): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes/${id}/rating`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stars }),
        });
    }

    it('rates a public recipe owned by someone else: 200 with a full RecipeDetail carrying the fresh aggregate', async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Rate me');

        const res = await putRating(recipe, 5);
        expect(res.status).toBe(200);
        const body = (await res.json()) as RecipeDetailBody;

        // The refreshed aggregate is DB-derived through the real write path (trigger), not computed here.
        expect(body.ratingCount).toBe(1);
        expect(body.averageRating).toBe(5);
        // It is the full detail the contract mandates — the four detail-only keys are present.
        expect(body.ingredients).toEqual([]);
        expect(body.steps).toEqual([]);
        expect(body.photos).toEqual([]);
        expect(body.nutrition).toBeTypeOf('object');

        // And a fresh GET agrees (the aggregate is persisted, not a per-response fabrication).
        const get = await fetch(`${baseUrl}/api/v1/recipes/${recipe}`);
        expect(((await get.json()) as RecipeDetailBody).averageRating).toBe(5);
    });

    it('re-rating UPDATES the single row (count stays 1) and replaces the stars', async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Re-rate me');

        await putRating(recipe, 2);
        const res = await putRating(recipe, 4);
        const body = (await res.json()) as RecipeDetailBody;

        expect(body.ratingCount).toBe(1); // never a second row
        expect(body.averageRating).toBe(4); // replaced, not averaged with the old 2
    });

    it("averages TWO users' ratings (count 2, mean correct) through the read path", async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Two raters');

        await putRating(recipe, 5); // the booted RATER, via HTTP
        // A second rater via SQL exercises the same trigger; the GET proves count + average compose.
        await pool.query(`INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES ($1, $2, 2)`, [
            recipe,
            SECOND_RATER,
        ]);

        const get = await fetch(`${baseUrl}/api/v1/recipes/${recipe}`);
        const body = (await get.json()) as RecipeDetailBody;
        expect(body.ratingCount).toBe(2);
        expect(body.averageRating).toBe(3.5); // (5 + 2) / 2 — a sum would be 7, "latest" would be 2
    });

    it('403 CANNOT_RATE_OWN_RECIPE when the caller owns the recipe (and writes nothing)', async () => {
        const own = await seedRecipe(RATER, 'public', 'My own recipe');

        const res = await putRating(own, 5);
        expect(res.status).toBe(403);
        expect(((await res.json()) as ErrorBody).code).toBe('CANNOT_RATE_OWN_RECIPE');

        const { rows } = await pool.query('SELECT 1 FROM recipe_ratings WHERE recipe_id = $1', [own]);
        expect(rows).toHaveLength(0);
    });

    it('404 RECIPE_NOT_FOUND — NOT 403 — for a private recipe the caller cannot see (IDOR boundary)', async () => {
        const privateNotMine = await seedRecipe(OTHER_OWNER, 'private', 'Secret');

        const res = await putRating(privateNotMine, 5);
        // The crux: a 403 here would confirm the recipe exists. It MUST be the same 404 a missing id gives.
        expect(res.status).toBe(404);
        expect(((await res.json()) as ErrorBody).code).toBe('RECIPE_NOT_FOUND');

        const { rows } = await pool.query('SELECT 1 FROM recipe_ratings WHERE recipe_id = $1', [privateNotMine]);
        expect(rows).toHaveLength(0);
    });

    it('404 for a non-existent recipe id', async () => {
        const res = await putRating('00000000-0000-4000-8000-0000deadbeef', 5);
        expect(res.status).toBe(404);
    });

    it('400 for out-of-range stars (DTO + DB CHECK bound), writing nothing', async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Bad stars');

        expect((await putRating(recipe, 0)).status).toBe(400);
        expect((await putRating(recipe, 6)).status).toBe(400);

        const { rows } = await pool.query('SELECT 1 FROM recipe_ratings WHERE recipe_id = $1', [recipe]);
        expect(rows).toHaveLength(0);
    });

    it("DELETE removes the caller's rating and resets the aggregate to unrated (count 0, no average)", async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Delete me');
        await putRating(recipe, 4);

        const del = await fetch(`${baseUrl}/api/v1/recipes/${recipe}/rating`, { method: 'DELETE' });
        expect(del.status).toBe(204);

        const get = await fetch(`${baseUrl}/api/v1/recipes/${recipe}`);
        const body = (await get.json()) as RecipeDetailBody;
        expect(body.ratingCount).toBe(0);
        // Unrated → the average is ABSENT (never a real 0-star score).
        expect(body.averageRating).toBeUndefined();
    });

    it('DELETE is idempotent — removing a rating the caller never made still returns 204', async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Never rated');

        const del = await fetch(`${baseUrl}/api/v1/recipes/${recipe}/rating`, { method: 'DELETE' });
        expect(del.status).toBe(204);
    });

    it('DELETE 404s (not 403) for a private recipe the caller cannot see', async () => {
        const privateNotMine = await seedRecipe(OTHER_OWNER, 'private', 'Secret to delete');

        const del = await fetch(`${baseUrl}/api/v1/recipes/${privateNotMine}/rating`, { method: 'DELETE' });
        expect(del.status).toBe(404);
    });
});
