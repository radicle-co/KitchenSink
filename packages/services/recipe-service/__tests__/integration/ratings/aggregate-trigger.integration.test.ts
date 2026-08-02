/**
 * CR-001 / FR-013a — the rating-aggregate trigger `recipe_ratings_aggregate_refresh()` against REAL
 * Postgres 16. The denormalized `recipes.average_rating` / `recipes.rating_count` are maintained ONLY by
 * this trigger, so this is the tier that proves the database — not application code — keeps them correct
 * under insert / update / delete / bulk-delete / FK-cascade / concurrent-write.
 *
 * Why a direct pg pool (not the booted app): the write path (`PUT/DELETE /api/v1/recipes/{id}/rating`) does
 * not exist yet — it is a later task. The trigger fires on ANY write to `recipe_ratings`, so raw SQL
 * against the schema exercises exactly the invariant this task owns, and two independent connections are
 * what the deterministic lost-update proof needs. Only a real Postgres has the trigger, the FOR UPDATE
 * lock semantics under READ COMMITTED, and the transition tables — a mock proves none of it.
 *
 * Runs only when the harness DB is up (`DATABASE_URL`), skipped in lockstep with global setup.
 *
 * Mutation map (each assertion pins a way the trigger could be subtly wrong):
 *   - avg computed as SUM, or without dividing by count → the avg assertions fail.
 *   - last-rating delete not resetting to NULL/0 → the "unrated" assertions fail (and the coherence CHECK
 *     would reject the write).
 *   - a ROW-level trigger instead of STATEMENT-level → the bulk-delete `calls=1` assertion fails (calls=N).
 *   - the FOR UPDATE lock dropped → the deterministic concurrent-write test loses an update (count 1, not 2).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** Owner of the recipes under test (app-user ULID; no FK). */
const OWNER = '01JRATINGTRIG000OWNER00000A';
/** Two distinct raters. */
const RATER_1 = '01JRATINGTRIG00RATER100000A';
const RATER_2 = '01JRATINGTRIG00RATER200000B';
/** A heavy rater whose bulk delete (GDPR sweep) must re-derive every affected recipe in ONE firing. */
const HEAVY_RATER = '01JRATINGTRIG00HEAVY00000AA';

describe.skipIf(!canRun)('recipe_ratings aggregate trigger (CR-001 integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
    });

    afterEach(async () => {
        // Ratings cascade when their recipe is deleted; delete the recipes this suite created (by owner)
        // and any stray ratings by the test raters on surviving recipes.
        await pool.query('DELETE FROM recipe_ratings WHERE user_id = ANY($1)', [[RATER_1, RATER_2, HEAVY_RATER]]);
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert a recipe owned by OWNER and return its id. */
    async function newRecipe(title: string): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, 2, 5, 10, 15) RETURNING id`,
            [OWNER, title],
        );
        return rows[0]!.id;
    }

    /** Read a recipe's denormalized aggregate. `average_rating` is a numeric → pg returns a string|null. */
    async function readAggregate(recipeId: string): Promise<{ count: number; average: number | null }> {
        const { rows } = await pool.query<{ rating_count: number; average_rating: string | null }>(
            'SELECT rating_count, average_rating FROM recipes WHERE id = $1',
            [recipeId],
        );
        const row = rows[0]!;
        return { count: row.rating_count, average: row.average_rating === null ? null : Number(row.average_rating) };
    }

    /** Upsert a rating (mirrors the idempotent PUT the trigger must react to). */
    async function rate(recipeId: string, userId: string, stars: number): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES ($1, $2, $3)
             ON CONFLICT (recipe_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`,
            [recipeId, userId, stars],
        );
    }

    it('starts a fresh recipe unrated: count 0, average NULL (never 0.00)', async () => {
        const recipe = await newRecipe('Fresh');
        expect(await readAggregate(recipe)).toEqual({ count: 0, average: null });
    });

    it('re-derives count + average on INSERT of a rating', async () => {
        const recipe = await newRecipe('Rated once');
        await rate(recipe, RATER_1, 4);
        expect(await readAggregate(recipe)).toEqual({ count: 1, average: 4 });
    });

    it('averages MULTIPLE ratings (not a sum, not the latest)', async () => {
        const recipe = await newRecipe('Two raters');
        await rate(recipe, RATER_1, 5);
        await rate(recipe, RATER_2, 2);
        // (5 + 2) / 2 = 3.50 — a SUM would give 7, "latest" would give 2.
        expect(await readAggregate(recipe)).toEqual({ count: 2, average: 3.5 });
    });

    it('recomputes on UPDATE (a user re-rating replaces, never adds a row)', async () => {
        const recipe = await newRecipe('Re-rate');
        await rate(recipe, RATER_1, 1);
        await rate(recipe, RATER_2, 5);
        expect(await readAggregate(recipe)).toEqual({ count: 2, average: 3 });

        await rate(recipe, RATER_1, 5); // re-rate: now both are 5
        expect(await readAggregate(recipe)).toEqual({ count: 2, average: 5 });
    });

    it('recomputes on DELETE, and resets to unrated (count 0, average NULL) when the last rating goes', async () => {
        const recipe = await newRecipe('Delete down to zero');
        await rate(recipe, RATER_1, 4);
        await rate(recipe, RATER_2, 2);
        expect(await readAggregate(recipe)).toEqual({ count: 2, average: 3 });

        await pool.query('DELETE FROM recipe_ratings WHERE recipe_id = $1 AND user_id = $2', [recipe, RATER_2]);
        expect(await readAggregate(recipe)).toEqual({ count: 1, average: 4 });

        await pool.query('DELETE FROM recipe_ratings WHERE recipe_id = $1 AND user_id = $2', [recipe, RATER_1]);
        // The crux: back to NULL/0, not 0.00/0 — a stale count or a 0 average would be a genuine
        // zero-star score, and would violate recipes_rating_aggregate_coherent.
        expect(await readAggregate(recipe)).toEqual({ count: 0, average: null });
    });

    it('cascades cleanly when the RECIPE is deleted (the del trigger no-ops against the vanished row)', async () => {
        const recipe = await newRecipe('To be deleted');
        await rate(recipe, RATER_1, 3);
        // No throw, no orphan: DELETE recipes → cascade to recipe_ratings → del trigger UPDATE matches 0 rows.
        await pool.query('DELETE FROM recipes WHERE id = $1', [recipe]);
        const { rows } = await pool.query('SELECT 1 FROM recipe_ratings WHERE recipe_id = $1', [recipe]);
        expect(rows).toHaveLength(0);
    });

    it('re-derives EVERY affected recipe in ONE trigger firing on a bulk delete (statement-level, GDPR sweep)', async () => {
        // One heavy rater rates three recipes; other raters keep them from going to zero.
        const recipes = await Promise.all([newRecipe('B1'), newRecipe('B2'), newRecipe('B3')]);
        for (const recipe of recipes) {
            await rate(recipe, HEAVY_RATER, 5);
            await rate(recipe, RATER_1, 3);
        }
        for (const recipe of recipes) {
            expect(await readAggregate(recipe)).toEqual({ count: 2, average: 4 });
        }

        // The erasure sweep: ONE statement deleting the heavy rater's ratings across all three recipes.
        // EXPLAIN ANALYZE executes it and reports the trigger firing count. A statement-level trigger
        // fires exactly ONCE regardless of row count; a FOR EACH ROW trigger would report calls=3.
        const explain = await pool.query<{ 'QUERY PLAN': string }>(
            'EXPLAIN (ANALYZE, TIMING OFF) DELETE FROM recipe_ratings WHERE user_id = $1',
            [HEAVY_RATER],
        );
        const planText = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
        const match = planText.match(/Trigger trg_recipe_ratings_agg_del:\s*calls=(\d+)/);
        expect(match, `expected a del-trigger line in:\n${planText}`).not.toBeNull();
        expect(Number(match![1])).toBe(1);

        // ...and every survivor's aggregate re-derived to the remaining rater's single 3-star rating.
        for (const recipe of recipes) {
            expect(await readAggregate(recipe)).toEqual({ count: 1, average: 3 });
        }
    });

    it('applies the migration safely: a recipe inserted with no CR-001 fields gets difficulty NULL, count 0', async () => {
        // Proves the ADD COLUMNs backfill correctly and the coherence CHECK admits the default pairing —
        // the "safe against existing rows" property (a row that predates the columns behaves identically).
        const recipe = await newRecipe('No CR-001 fields set');
        const { rows } = await pool.query<{
            difficulty: string | null;
            rating_count: number;
            average_rating: string | null;
        }>('SELECT difficulty, rating_count, average_rating FROM recipes WHERE id = $1', [recipe]);
        expect(rows[0]).toEqual({ difficulty: null, rating_count: 0, average_rating: null });
    });

    it('enforces the difficulty enum CHECK (NULL passes; an out-of-set value is rejected)', async () => {
        const recipe = await newRecipe('Difficulty check');
        await pool.query(`UPDATE recipes SET difficulty = 'easy' WHERE id = $1`, [recipe]); // NULL→value ok
        await pool.query(`UPDATE recipes SET difficulty = NULL WHERE id = $1`, [recipe]); // clear ok
        await expect(
            pool.query(`UPDATE recipes SET difficulty = 'trivial' WHERE id = $1`, [recipe]),
        ).rejects.toMatchObject(
            { code: '23514' }, // check_violation
        );
    });

    it('makes an incoherent aggregate pairing unrepresentable (recipes_rating_aggregate_coherent)', async () => {
        const recipe = await newRecipe('Coherence check');
        // A count with no average, or an average with no count, is exactly what the CHECK forbids.
        await expect(
            pool.query('UPDATE recipes SET rating_count = 3, average_rating = NULL WHERE id = $1', [recipe]),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
            pool.query('UPDATE recipes SET rating_count = 0, average_rating = 4.00 WHERE id = $1', [recipe]),
        ).rejects.toMatchObject({ code: '23514' });
    });

    it('does not lose an update when two users rate the same recipe concurrently (FOR UPDATE guard)', async () => {
        const recipe = await newRecipe('Concurrent');
        const c1 = await pool.connect();
        const c2 = await pool.connect();

        try {
            // c1 inserts and holds the transaction open — its trigger has locked the recipe row.
            await c1.query('BEGIN');
            await c1.query('INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES ($1, $2, 5)', [
                recipe,
                RATER_1,
            ]);

            // c2 inserts concurrently; a distinctive comment lets us spot it blocked on the row lock.
            await c2.query('BEGIN');
            const c2Insert = c2.query(
                'INSERT INTO recipe_ratings /* c2-lost-update-probe */ (recipe_id, user_id, stars) VALUES ($1, $2, 3)',
                [recipe, RATER_2],
            );

            // Deterministic barrier (NOT a sleep): wait until c2's backend is actually blocked on a lock.
            await waitForBlockedBackend(pool, 'c2-lost-update-probe');

            // Release c1. c2 now unblocks, and — because it takes the row lock FIRST — recomputes on a
            // snapshot that SEES c1's committed rating.
            await c1.query('COMMIT');
            await c2Insert;
            await c2.query('COMMIT');

            // Ground truth: two ratings (5, 3), average 4.00. Without FOR UPDATE, c2's recompute would
            // have run on a pre-commit snapshot and written a stale count=1 over the fresh one.
            expect(await readAggregate(recipe)).toEqual({ count: 2, average: 4 });
        } finally {
            c1.release();
            c2.release();
        }
    });
});

/**
 * Poll `pg_stat_activity` until a backend running a query containing `marker` is waiting on a lock.
 * Deterministic — it waits on a real condition (a Lock wait_event), not an arbitrary interval.
 */
async function waitForBlockedBackend(pool: pg.Pool, marker: string): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
        const { rows } = await pool.query<{ blocked: number }>(
            `SELECT count(*)::int AS blocked FROM pg_stat_activity
             WHERE wait_event_type = 'Lock' AND state = 'active' AND query LIKE '%' || $1 || '%'`,
            [marker],
        );
        if ((rows[0]?.blocked ?? 0) > 0) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for a backend blocked on a lock (marker: ${marker}).`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}
