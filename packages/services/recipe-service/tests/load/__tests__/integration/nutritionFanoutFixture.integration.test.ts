/**
 * The nutrition-batch load fixture must MANUFACTURE FAN-OUT — ADR-0021 "Residual risk", REQ-IF-008,
 * REQ-NF-006.
 *
 * | Requirement / ruling                                     | Test                                                     |
 * | -------------------------------------------------------- | -------------------------------------------------------- |
 * | ADR-0021 §4 — cost is `ceil(foods / 100) / 6` waves      | `the disjoint set forces a multi-wave fan-out`          |
 * | ADR-0021 "Residual risk" — padding measures nothing      | `padding with unresolvable ids adds no distinct food`   |
 * | REQ-IF-008 — 500 recipe ids, absence = not readable      | `every fixture recipe is readable by any viewer`        |
 * | REQ-NF-006 — the p95 the fan-out has to fit inside       | `the two sets differ ONLY in ingredient overlap`        |
 *
 * ## Why this tier, and not a unit test
 *
 * The property under test is "how many DISTINCT foods does a 500-recipe request name", and that number is
 * produced by rows in three tables joined by two foreign keys. A unit test of the id-generating arithmetic
 * would prove the generator self-consistent while the seed inserted ten rows, or every line pointed at one
 * ingredient, or the recipes landed `private` and the endpoint omitted all of them — each of which leaves
 * the k6 scenario green on a case that cannot fail, which is the exact defect this fixture exists to
 * remove. So the counts here are read back out of Postgres with SQL that walks the same
 * `recipes → recipe_ingredients → ingredients.food_id` path the service walks, never from the generator.
 *
 * Seeds into whatever `DATABASE_URL` names (the integration harness's disposable database) and cleans up
 * after itself, so it cannot leave 1,000 recipes behind for a neighbouring spec to count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { MASS_UNIT_TO_GRAMS } from '@kitchensink/recipe-core';

import {
    FANOUT_LINES_PER_RECIPE,
    FANOUT_RECIPE_COUNT,
    FIXTURE_LINE_UNIT,
    FOOD_CHUNK_SIZE,
    MAX_CONCURRENT_CHUNKS,
    OVERLAP_STAPLE_COUNT,
    chunksFor,
    fanoutRecipeId,
    overlapRecipeId,
    unresolvableRecipeId,
    wavesFor,
} from '../../nutritionFanoutFixture.js';
import { deleteNutritionFanoutFixture, seedNutritionFanoutFixture } from '../../prepareNutritionFanoutFixture.js';
import type { NutritionFanoutFixture } from '../../nutritionFanoutFixture.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The `IN (…)` list of a set's recipe ids, as one bound parameter (a `uuid[]`). */
const DISTINCT_FOODS_SQL = `
    SELECT count(DISTINCT i.food_id)::int AS foods,
           count(DISTINCT r.id)::int      AS recipes,
           count(li.id)::int              AS lines
      FROM recipes r
      JOIN recipe_ingredients li ON li.recipe_id = r.id
      JOIN ingredients i         ON i.id = li.ingredient_id
     WHERE r.id = ANY($1::uuid[])`;

interface SetShape {
    foods: number;
    recipes: number;
    lines: number;
}

let pool: pg.Pool;
let fixture: NutritionFanoutFixture;

/** What the service would see for a set of recipe ids: readable recipes, their lines, their distinct foods. */
async function shapeOf(recipeIds: readonly string[]): Promise<SetShape> {
    const { rows } = await pool.query<SetShape>(DISTINCT_FOODS_SQL, [[...recipeIds]]);

    return rows[0] as SetShape;
}

describe.skipIf(!DATABASE_URL)('the nutrition-batch load fixture manufactures fan-out', () => {
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        fixture = await seedNutritionFanoutFixture(pool);
    }, 120_000);

    afterAll(async () => {
        if (pool !== undefined) {
            await deleteNutritionFanoutFixture(pool);
            await pool.end();
        }
    }, 60_000);

    it('the disjoint set forces a multi-wave fan-out at the published cap', async () => {
        const shape = await shapeOf(fixture.fanout.recipeIds);

        expect(shape.recipes).toBe(FANOUT_RECIPE_COUNT);
        expect(shape.lines).toBe(FANOUT_RECIPE_COUNT * FANOUT_LINES_PER_RECIPE);
        // The whole point: distinct FOODS scales with recipe count, so the gateway must chunk and wave.
        expect(shape.foods).toBe(FANOUT_RECIPE_COUNT * FANOUT_LINES_PER_RECIPE);
        expect(chunksFor(shape.foods)).toBe(Math.ceil(shape.foods / FOOD_CHUNK_SIZE));
        expect(wavesFor(shape.foods)).toBe(Math.ceil(chunksFor(shape.foods) / MAX_CONCURRENT_CHUNKS));
        expect(wavesFor(shape.foods)).toBeGreaterThan(1);
    });

    it('reports the SAME food count it measured, so the k6 script asserts against reality', async () => {
        const shape = await shapeOf(fixture.fanout.recipeIds);

        expect(fixture.fanout.distinctFoodCount).toBe(shape.foods);
        expect(fixture.fanout.expectedWaves).toBe(wavesFor(shape.foods));
        expect(fixture.fanout.expectedChunks).toBe(chunksFor(shape.foods));
    });

    it('the high-overlap set names the same recipes and an order of magnitude fewer foods', async () => {
        const overlap = await shapeOf(fixture.overlap.recipeIds);
        const fanout = await shapeOf(fixture.fanout.recipeIds);

        // The two sets differ ONLY in ingredient overlap — same recipe count, same line count — which is
        // what makes the latency difference between them attributable to fan-out and nothing else.
        expect(overlap.recipes).toBe(fanout.recipes);
        expect(overlap.lines).toBe(fanout.lines);
        expect(overlap.foods).toBeLessThanOrEqual(OVERLAP_STAPLE_COUNT);
        expect(wavesFor(overlap.foods)).toBe(1);
        expect(overlap.foods * 10).toBeLessThan(fanout.foods);
    });

    it('padding with unresolvable ids adds no distinct food — the defect this replaces', async () => {
        // The superseded `capBatch` padded a short seeded list to 500 with well-formed ids that resolve to
        // no recipe. This asserts what that measured: the food count does not move, so the fan-out stayed
        // at one call however wide the request got.
        const seeded = fixture.overlap.recipeIds.slice(0, 20);
        const padded = [...seeded];

        for (let index = padded.length; index < FANOUT_RECIPE_COUNT; index += 1) {
            // From the fixture's OWN id space, not a parallel scheme invented here — see
            // `unresolvableRecipeId`. A hand-rolled range collides with whatever else the shared CI
            // database holds, which turns this assertion into a claim about neighbouring specs.
            padded.push(unresolvableRecipeId(index));
        }

        const short = await shapeOf(seeded);
        const wide = await shapeOf(padded);

        expect(wide.foods).toBe(short.foods);
        expect(wavesFor(wide.foods)).toBe(1);
    });

    it('every fixture recipe is readable by any viewer, or the endpoint omits it', async () => {
        // REQ-IF-008: a recipe the caller may not read is OMITTED from the map. A `private` or `draft`
        // fixture recipe would therefore produce an empty response that still answers 200 in 3ms.
        const { rows } = await pool.query<{ unreadable: number }>(
            `SELECT count(*)::int AS unreadable
               FROM recipes
              WHERE id = ANY($1::uuid[])
                AND (visibility <> 'public' OR status <> 'published' OR deleted_at IS NOT NULL)`,
            [[...fixture.fanout.recipeIds, ...fixture.overlap.recipeIds]],
        );

        expect(rows[0]?.unreadable).toBe(0);
    });

    it('every line converts to grams, so a resolved food yields `known` rather than `no_nutrient_data`', async () => {
        // A unit the converter cannot turn into a mass produces `unaccounted{no_nutrient_data}` — the same
        // 200 the scenario would report as a pass while proving the food data was never applied.
        expect(MASS_UNIT_TO_GRAMS[FIXTURE_LINE_UNIT]).toBeGreaterThan(0);

        const { rows } = await pool.query<{ unconvertible: number }>(
            `SELECT count(*)::int AS unconvertible
               FROM recipe_ingredients li
              WHERE li.recipe_id = ANY($1::uuid[])
                AND li.unit <> $2`,
            [[...fixture.fanout.recipeIds, ...fixture.overlap.recipeIds], FIXTURE_LINE_UNIT],
        );

        expect(rows[0]?.unconvertible).toBe(0);
    });

    it('every fan-out ingredient references its own food — the disjointness invariant', async () => {
        const { rows } = await pool.query<{ shared: number }>(
            `SELECT count(*)::int AS shared
               FROM (SELECT i.food_id
                       FROM recipes r
                       JOIN recipe_ingredients li ON li.recipe_id = r.id
                       JOIN ingredients i         ON i.id = li.ingredient_id
                      WHERE r.id = ANY($1::uuid[])
                      GROUP BY i.food_id
                     HAVING count(DISTINCT r.id) > 1) AS shared_foods`,
            [[...fixture.fanout.recipeIds]],
        );

        expect(rows[0]?.shared).toBe(0);
    });

    it('is idempotent — a re-run seeds the same world, never a second copy', async () => {
        const before = await shapeOf(fixture.fanout.recipeIds);

        await seedNutritionFanoutFixture(pool);

        const after = await shapeOf(fixture.fanout.recipeIds);

        expect(after).toEqual(before);
    }, 120_000);

    it('mints ids that are stable across runs, so the fixture and the k6 script cannot drift', () => {
        expect(fixture.fanout.recipeIds[0]).toBe(fanoutRecipeId(0));
        expect(fixture.fanout.recipeIds).toHaveLength(FANOUT_RECIPE_COUNT);
        expect(fixture.overlap.recipeIds[0]).toBe(overlapRecipeId(0));
        expect(fixture.overlap.recipeIds).toHaveLength(FANOUT_RECIPE_COUNT);
        expect(new Set(fixture.fanout.recipeIds)).not.toContain(overlapRecipeId(0));
    });
});
