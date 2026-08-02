/**
 * CR-001 / FR-013 — e2e proof of the rating write surface through the fully ASSEMBLED recipe app
 * (`ThrottlerModule` + global guard, `AuthMiddleware`, `ApiExceptionFilter`, real HTTP) via
 * `bootRecipeApp`. Where the integration spec exhausts the aggregate/authorization branches, this pins
 * the client-visible HTTP contract of `PUT`/`DELETE /api/v1/recipes/{id}/rating`: the status codes and the
 * response shape a caller actually receives.
 *
 * The booted app authenticates as the RATER (dev bypass). Recipes are seeded via a direct pg pool so the
 * rater can rate a recipe owned by someone else (200), be blocked on their own (403), and get a
 * non-leaking 404 on a private recipe they cannot see. Skips when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const RATER = '01JRATEE2E0000CALLER00000A';
const OTHER_OWNER = '01JRATEE2E00000OWNER00000B';

describe.skipIf(!hasDatabaseUrl)('rating write surface (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: RATER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[OTHER_OWNER, RATER]]);
        await pool.end();
        await booted?.close();
    });

    async function seedRecipe(ownerId: string, visibility: 'public' | 'private', title: string): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, $3, 2, 5, 10, 15) RETURNING id`,
            [ownerId, title, visibility],
        );
        return rows[0]!.id;
    }

    it('PUT then DELETE a rating on a public recipe: 200 (RecipeDetail) then 204', async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'E2E rate');

        const put = await fetch(`${booted.baseUrl}/api/v1/recipes/${recipe}/rating`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stars: 4 }),
        });
        expect(put.status).toBe(200);
        const body = (await put.json()) as { id: string; ratingCount: number; averageRating?: number };
        expect(body.id).toBe(recipe);
        expect(body.ratingCount).toBe(1);
        expect(body.averageRating).toBe(4);

        const del = await fetch(`${booted.baseUrl}/api/v1/recipes/${recipe}/rating`, { method: 'DELETE' });
        expect(del.status).toBe(204);
    });

    it("PUT on the caller's own recipe is 403", async () => {
        const own = await seedRecipe(RATER, 'public', 'E2E own');

        const put = await fetch(`${booted.baseUrl}/api/v1/recipes/${own}/rating`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stars: 5 }),
        });
        expect(put.status).toBe(403);
    });

    it('PUT on a private recipe the caller cannot see is 404 (not 403 — no existence leak)', async () => {
        const secret = await seedRecipe(OTHER_OWNER, 'private', 'E2E secret');

        const put = await fetch(`${booted.baseUrl}/api/v1/recipes/${secret}/rating`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stars: 5 }),
        });
        expect(put.status).toBe(404);
    });

    it('PUT on a PUBLIC DRAFT is 404 AND leaves the rating aggregate unmutated (W8-a.3/.10)', async () => {
        // A free-tier draft is visibility='public'; a stranger must not be able to rate an unpublished
        // recipe — and, crucially, the attempt must not touch its rating aggregate (the single place a
        // regression could make average_rating/rating_count semantically wrong on an invisible row).
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, 'E2E draft', 'public', 'draft', 2, 5, 10, 15) RETURNING id`,
            [OTHER_OWNER],
        );
        const draftId = rows[0]!.id;

        const put = await fetch(`${booted.baseUrl}/api/v1/recipes/${draftId}/rating`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stars: 5 }),
        });
        expect(put.status).toBe(404);

        // The aggregate is untouched: no rating row, still no average and a zero count.
        const agg = await pool.query<{ rating_count: number; average_rating: string | null }>(
            'SELECT rating_count, average_rating FROM recipes WHERE id = $1',
            [draftId],
        );
        expect(Number(agg.rows[0]!.rating_count)).toBe(0);
        expect(agg.rows[0]!.average_rating).toBeNull();
        const ratingRows = await pool.query('SELECT 1 FROM recipe_ratings WHERE recipe_id = $1', [draftId]);
        expect(ratingRows.rowCount).toBe(0);
    });
});
