/**
 * CR-001 / FR-013 — unit tests for {@link RatingsDal}.
 *
 * The DAL is exercised over a REAL Drizzle client backed by a fake `pg` pool whose `query` captures the
 * rendered SQL text (and returns canned rows). This is stronger than a recorded-builder-args fake: it
 * pins the ACTUAL SQL the DAL emits, so the two properties this task must guarantee are asserted against
 * the real statement Postgres would receive —
 *
 *   - the upsert's conflict target is `("recipe_id","user_id")` (the unique constraint), and
 *   - the `DO UPDATE` set includes `"updated_at" = now()` (the handoff gotcha: the column default fires
 *     only on INSERT, so a re-rate that forgets this leaves `updated_at` stale).
 *
 * The trigger-maintained `recipes.average_rating` / `recipes.rating_count` are NOT touched here — the DAL
 * writes ONLY `recipe_ratings`; the aggregate is proven by the real-Postgres integration specs.
 */
import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';

import { RatingsDal } from '../ratings.dal.js';
import * as schema from '../../../database/schema/index.js';

/** A captured `client.query` call: the rendered SQL text and its bound parameters. */
interface CapturedQuery {
    text: string;
    params: unknown[];
}

/**
 * Build a real schema-typed Drizzle client over a fake `pg` pool. Drizzle renders the SQL and calls
 * `pool.query({ text, rowMode:'array', ... }, params)`; the fake records it and returns the next canned
 * result. Because `rowMode` is `array`, canned rows are column-value arrays (Drizzle maps them back).
 */
function makeCapturingDal(cannedRows: unknown[][][]): { dal: RatingsDal; queries: CapturedQuery[] } {
    const queries: CapturedQuery[] = [];
    let call = 0;
    const fakePool = {
        query: (config: { text: string }, params: unknown[]): Promise<{ rows: unknown[][]; rowCount: number }> => {
            queries.push({ text: config.text, params });
            const rows = cannedRows[call] ?? [];
            call += 1;

            return Promise.resolve({ rows, rowCount: rows.length });
        },
    };
    const db = drizzle(fakePool as never, { schema });

    return { dal: new RatingsDal(db), queries };
}

/** The `recipe_ratings` returning-column order (id, recipe_id, user_id, stars, created_at, updated_at). */
function ratingRow(stars: number): unknown[] {
    return ['00000000-0000-4000-8000-0000000000r1', 'rec-1', 'user-1', stars, '2026-01-01', '2026-01-02'];
}

describe('RatingsDal.upsert', () => {
    it('emits an ON CONFLICT (recipe_id, user_id) DO UPDATE that sets stars AND updated_at = now()', async () => {
        const { dal, queries } = makeCapturingDal([[ratingRow(4)]]);

        const row = await dal.upsert({ recipeId: 'rec-1', userId: 'user-1', stars: 4 });

        expect(queries).toHaveLength(1);
        const sql = queries[0]!.text.toLowerCase();
        // Idempotent upsert keyed on the unique constraint's columns — never a second row per (recipe,user).
        expect(sql).toContain('insert into "recipe_ratings"');
        expect(sql).toContain('on conflict ("recipe_id","user_id") do update set');
        // The crux: stars is replaced AND updated_at is bumped (the INSERT-only default would leave it stale).
        expect(sql).toContain('"stars" =');
        expect(sql).toContain('"updated_at" = now()');
        // The rater id + stars are bound, never interpolated.
        expect(queries[0]!.params).toEqual(expect.arrayContaining(['rec-1', 'user-1', 4]));
        // The persisted row is returned, Drizzle-mapped from the array row.
        expect(row).toMatchObject({ recipeId: 'rec-1', userId: 'user-1', stars: 4 });
    });

    it('binds the new star value into the DO UPDATE set (a re-rate replaces the stored stars)', async () => {
        const { dal, queries } = makeCapturingDal([[ratingRow(2)]]);

        await dal.upsert({ recipeId: 'rec-9', userId: 'user-9', stars: 2 });

        // The star value appears as a bound param for BOTH the insert value and the conflict-update set.
        expect(queries[0]!.params.filter((p) => p === 2)).toHaveLength(2);
    });
});

describe('RatingsDal.delete', () => {
    it("deletes exactly the caller's (recipe_id, user_id) row and reports a row was removed", async () => {
        const { dal, queries } = makeCapturingDal([[['00000000-0000-4000-8000-0000000000r1']]]);

        const removed = await dal.delete('rec-1', 'user-1');

        expect(removed).toBe(true);
        const sql = queries[0]!.text.toLowerCase();
        expect(sql).toContain('delete from "recipe_ratings"');
        expect(sql).toContain('"recipe_id" =');
        expect(sql).toContain('"user_id" =');
        expect(queries[0]!.params).toEqual(['rec-1', 'user-1']);
    });

    it('reports no row removed when the caller had no rating (idempotent DELETE → clean no-op)', async () => {
        const { dal } = makeCapturingDal([[]]);

        expect(await dal.delete('rec-1', 'user-1')).toBe(false);
    });
});
