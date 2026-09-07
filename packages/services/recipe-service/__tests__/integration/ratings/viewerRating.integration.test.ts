/**
 * CR-001 / FR-013 — the `RecipeDetail.viewerRating` read projection, end to end against the REAL booted
 * Nest app + Docker Postgres. Where the sibling `rating-write` spec proves the WRITE path and the
 * community aggregate, this proves the per-VIEWER field the detail read now carries so the rating control
 * can pre-select the viewer's existing stars:
 *
 *   - A recipe the viewer HAS rated → `viewerRating` is present and equals THEIR stars.
 *   - A recipe the viewer has NOT rated → `viewerRating` is ABSENT (never a fabricated 0), even when the
 *     recipe is rated by others (its community `ratingCount`/`averageRating` still populate).
 *   - The crux (viewer-scoping / no leak): another user's rating of the SAME recipe does NOT surface as
 *     this viewer's `viewerRating`; each viewer sees only their own stars.
 *   - The viewer's OWN recipe → `viewerRating` ABSENT (an owner cannot rate their own recipe).
 *
 * The booted app authenticates as a single dev user (the VIEWER). A recipe owned by someone else, and
 * other users' ratings, are seeded via a direct pg pool so all branches are reachable from one boot. Uses
 * the throwaway harness DB; skips when it is not configured.
 *
 * Mutation map:
 *   - Drop the viewer scoping (return any rating on the recipe, not the caller's row) → the "another
 *     user's rating does not leak" assertion sees a stray `viewerRating` and FAILS.
 *   - Populate `viewerRating` from the community average instead of the viewer's row → the unrated-viewer
 *     (but community-rated) case reports a value and FAILS.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The dev-bypass caller these tests view AS (the VIEWER). */
const VIEWER = '01JVIEWRATING000CALLER0000A';
/** A distinct recipe owner (someone else). */
const OTHER_OWNER = '01JVIEWRATING0000OWNER0000B';
/** A distinct OTHER rater whose rating must never leak into the VIEWER's detail. */
const OTHER_RATER = '01JVIEWRATING000RATER20000C';

interface RecipeDetailBody {
    id: string;
    ownerId: string;
    ratingCount: number;
    averageRating?: number;
    viewerRating?: number;
}

describe.skipIf(!hasDatabaseUrl)('RecipeDetail.viewerRating (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: VIEWER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_ratings WHERE user_id = ANY($1)', [[VIEWER, OTHER_RATER]]);
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[OTHER_OWNER, VIEWER]]);
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

    /** Insert a rating directly (bypasses the write authorization — used to seed OTHER users' ratings). */
    async function seedRating(recipeId: string, userId: string, stars: number): Promise<void> {
        await pool.query(`INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES ($1, $2, $3)`, [
            recipeId,
            userId,
            stars,
        ]);
    }

    async function getDetail(recipeId: string): Promise<RecipeDetailBody> {
        const res = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}`);
        expect(res.status).toBe(200);

        return (await res.json()) as RecipeDetailBody;
    }

    it("returns viewerRating = the viewer's own stars for a recipe they rated", async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Rated by viewer');
        await seedRating(recipe, VIEWER, 4);

        const body = await getDetail(recipe);

        expect(body.viewerRating).toBe(4);
    });

    it('OMITS viewerRating for a recipe the viewer has NOT rated (even when others have)', async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Rated by others only');
        await seedRating(recipe, OTHER_RATER, 5);

        const body = await getDetail(recipe);

        // The community aggregate still populates from the other user's rating...
        expect(body.ratingCount).toBe(1);
        expect(body.averageRating).toBe(5);
        // ...but the VIEWER has no rating, so viewerRating is absent (never fabricated from the average).
        expect(body.viewerRating).toBeUndefined();
    });

    it("does NOT leak another viewer's rating: the viewer sees only their OWN stars", async () => {
        const recipe = await seedRecipe(OTHER_OWNER, 'public', 'Two raters, distinct stars');
        await seedRating(recipe, VIEWER, 2);
        await seedRating(recipe, OTHER_RATER, 5);

        const body = await getDetail(recipe);

        // The community average blends both (2 + 5) / 2 = 3.5, but viewerRating is strictly the caller's 2 —
        // never the other rater's 5, and never the average.
        expect(body.averageRating).toBe(3.5);
        expect(body.viewerRating).toBe(2);
    });

    it("OMITS viewerRating on the viewer's OWN recipe (an owner cannot rate their own)", async () => {
        const own = await seedRecipe(VIEWER, 'public', 'My own recipe');

        const body = await getDetail(own);

        expect(body.ownerId).toBe(VIEWER);
        expect(body.viewerRating).toBeUndefined();
    });
});
