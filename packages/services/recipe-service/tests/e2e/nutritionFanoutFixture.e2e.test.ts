/**
 * The nutrition-batch load fixture must MANUFACTURE FAN-OUT — ADR-0021 "Residual risk", REQ-IF-008,
 * REQ-NF-006. LOCAL e2e under the 2026-09-20 ruling: a real Postgres, and it never skips.
 *
 * | Requirement / ruling                                | Test                                                         |
 * | --------------------------------------------------- | ------------------------------------------------------------ |
 * | ADR-0021 §4 — cost is `ceil(foods / 100) / 6` waves | `the disjoint set forces a multi-wave fan-out`               |
 * | ADR-0021 "Residual risk" — padding measures nothing | `padding with unresolvable ids adds no distinct food`        |
 * | REQ-IF-008 — 500 recipe ids, absence = not readable | `every fixture recipe is readable by any viewer`             |
 * | REQ-NF-006 — the p95 the fan-out has to fit inside  | `the high-overlap set names the same recipes …`              |
 * | 0051 — only a ROOT binding names a food             | `every line is bound to a ROOT food …`                       |
 * | 0051 — food answers a private food for its author   | `every bound food is shared …`                               |
 * | 2026-09-20 — the e2e files share one database       | `cleanup removes every row the fixture wrote, and nothing …` |
 *
 * ## Why this tier, and not a unit test
 *
 * The property under test is "how many DISTINCT foods does a 500-recipe request name", and that number is
 * produced by rows in three tables joined by two foreign keys. A unit test of the id arithmetic would prove the
 * generator self-consistent while the seed inserted ten rows, or every line pointed at one binding, or the
 * recipes landed `private` and the endpoint omitted all of them. Each of those leaves the k6 scenario green on a
 * case that cannot fail, which is the defect this fixture exists to remove.
 *
 * So the counts are read back out of Postgres, along the path the service walks: `recipes` → `ingredients` (the
 * recipe LINES since migration 0051) → `food_lookups`. That is `RecipesDal.findNutritionInputs` followed by
 * `RecipeDetailAssembler.loadLineCatalog`, which asks food about the ROOT and the VARIANT arm alike (curated U9) and
 * about no failure record, so this walk counts `COALESCE(food_id, food_variant_id)`.
 *
 * It used to live in `tests/load/__tests__/integration/` and read `DATABASE_URL`, which that tier never sets.
 * So it skipped everywhere, and hid that the seeder still wrote the tables 0051 dropped.
 *
 * It seeds the e2e tier's own database as the SERVICE role (DML only) and cleans up after itself. The e2e files
 * share that database one at a time, and 1,000 leftover public recipes would change what a later suite counts.
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
    fixtureLookupIds,
    fixtureRecipeIds,
    overlapRecipeId,
    unresolvableRecipeId,
    wavesFor,
    type NutritionFanoutFixture,
} from '../load/nutritionFanoutFixture.js';
import { deleteNutritionFanoutFixture, seedNutritionFanoutFixture } from '../load/prepareNutritionFanoutFixture.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

/** A set's recipes, lines and distinct foods, walked the way the service walks them. */
const SET_SHAPE_SQL = `
    SELECT count(DISTINCT COALESCE(fl.food_id, fl.food_variant_id))::int AS foods,
           count(DISTINCT r.id)::int       AS recipes,
           count(li.id)::int               AS lines
      FROM recipes r
      JOIN ingredients li   ON li.recipe_id = r.id
      JOIN food_lookups fl  ON fl.id = li.food_lookup_id
     WHERE r.id = ANY($1::uuid[])`;

/** How many rows each table this fixture writes holds. */
const TABLE_COUNTS_SQL = `
    SELECT (SELECT count(*) FROM recipes)::int      AS recipes,
           (SELECT count(*) FROM ingredients)::int  AS lines,
           (SELECT count(*) FROM food_lookups)::int AS lookups`;

interface SetShape {
    foods: number;
    recipes: number;
    lines: number;
}

interface TableCounts {
    recipes: number;
    lines: number;
    lookups: number;
}

let pool: pg.Pool;
let fixture: NutritionFanoutFixture;
let before: TableCounts;

/** Every recipe id the seeder reported, both sets. */
function allFixtureRecipeIds(): string[] {
    return [...fixture.fanout.recipeIds, ...fixture.overlap.recipeIds];
}

/** What the service would see for a set of recipe ids: readable recipes, their lines, their distinct foods. */
async function shapeOf(recipeIds: readonly string[]): Promise<SetShape> {
    const { rows } = await pool.query<SetShape>(SET_SHAPE_SQL, [[...recipeIds]]);

    return rows[0] as SetShape;
}

/** Row counts of the three tables the fixture writes. */
async function tableCounts(): Promise<TableCounts> {
    const { rows } = await pool.query<TableCounts>(TABLE_COUNTS_SQL);

    return rows[0] as TableCounts;
}

describe('the nutrition-batch load fixture manufactures fan-out (e2e, real Postgres)', () => {
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        before = await tableCounts();
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
        expect(fixture.overlap.distinctFoodCount).toBe(overlap.foods);
    });

    it('padding with unresolvable ids adds no distinct food — the defect this replaces', async () => {
        // The superseded `capBatch` padded a short seeded list to 500 with well-formed ids that resolve to
        // no recipe. This asserts what that measured: the food count does not move, so the fan-out stayed
        // at one call however wide the request got.
        const seeded = fixture.overlap.recipeIds.slice(0, 20);
        const padded = [...seeded];

        for (let index = padded.length; index < FANOUT_RECIPE_COUNT; index += 1) {
            // From the fixture's OWN id space, not a parallel scheme invented here — see `unresolvableRecipeId`.
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
            [allFixtureRecipeIds()],
        );

        expect(rows[0]?.unreadable).toBe(0);
    });

    it('every line converts to grams, so a resolved food yields `known` rather than `no_nutrient_data`', async () => {
        // A unit the converter cannot turn into a mass produces `unaccounted{no_nutrient_data}` — the same
        // 200 the scenario would report as a pass while proving the food data was never applied. Since 0051 a
        // line may also state NO amount (`quantity IS NULL`), which yields no mass whatever its unit.
        expect(MASS_UNIT_TO_GRAMS[FIXTURE_LINE_UNIT]).toBeGreaterThan(0);

        const { rows } = await pool.query<{ unconvertible: number }>(
            `SELECT count(*)::int AS unconvertible
               FROM ingredients li
              WHERE li.recipe_id = ANY($1::uuid[])
                AND (li.unit <> $2 OR li.quantity IS NULL)`,
            [allFixtureRecipeIds(), FIXTURE_LINE_UNIT],
        );

        expect(rows[0]?.unconvertible).toBe(0);
    });

    it('every line is bound to a food, and every fan-out recipe has exactly ONE variant-bound line (curated U9)', async () => {
        // A failure record names no food, so a line bound to one would shrink the fan-out without a single error.
        // A variant names one in food's one id namespace, and the service asks food about it as about a root.
        const { rows } = await pool.query<{ unbound: number; variantLines: number; recipesWithOne: number }>(
            `SELECT count(*) FILTER (WHERE fl.food_id IS NULL AND fl.food_variant_id IS NULL)::int AS unbound,
                    count(*) FILTER (WHERE fl.food_variant_id IS NOT NULL)::int AS "variantLines",
                    count(DISTINCT li.recipe_id) FILTER (WHERE fl.food_variant_id IS NOT NULL)::int AS "recipesWithOne"
               FROM ingredients li
               JOIN food_lookups fl ON fl.id = li.food_lookup_id
              WHERE li.recipe_id = ANY($1::uuid[])`,
            [[...fixture.fanout.recipeIds]],
        );

        expect(rows[0]).toStrictEqual({
            unbound: 0,
            variantLines: FANOUT_RECIPE_COUNT,
            recipesWithOne: FANOUT_RECIPE_COUNT,
        });
    });

    it('every bound food is shared, so food answers for any caller and not only for an author', async () => {
        // An owner on a binding records that the food is someone's PRIVATE authored food. Food still gets asked
        // about it, so the fan-out does not shrink — but food answers a private food only for its author, and
        // the load caller is not that author, so every such line would fall out of the `known` figure.
        const { rows } = await pool.query<{ owned: number }>(
            `SELECT count(*)::int AS owned
               FROM ingredients li
               JOIN food_lookups fl ON fl.id = li.food_lookup_id
              WHERE li.recipe_id = ANY($1::uuid[])
                AND fl.food_owner_id IS NOT NULL`,
            [allFixtureRecipeIds()],
        );

        expect(rows[0]?.owned).toBe(0);
    });

    it('every fan-out line references its own food — the disjointness invariant', async () => {
        const { rows } = await pool.query<{ shared: number }>(
            `SELECT count(*)::int AS shared
               FROM (SELECT COALESCE(fl.food_id, fl.food_variant_id) AS food
                       FROM recipes r
                       JOIN ingredients li  ON li.recipe_id = r.id
                       JOIN food_lookups fl ON fl.id = li.food_lookup_id
                      WHERE r.id = ANY($1::uuid[])
                      GROUP BY COALESCE(fl.food_id, fl.food_variant_id)
                     HAVING count(DISTINCT r.id) > 1) AS shared_foods`,
            [[...fixture.fanout.recipeIds]],
        );

        expect(rows[0]?.shared).toBe(0);
    });

    it('is idempotent — a re-run seeds the same world, never a second copy', async () => {
        const firstFanout = await shapeOf(fixture.fanout.recipeIds);
        const firstOverlap = await shapeOf(fixture.overlap.recipeIds);
        const firstCounts = await tableCounts();

        const rerun = await seedNutritionFanoutFixture(pool);

        expect(await shapeOf(fixture.fanout.recipeIds)).toEqual(firstFanout);
        expect(await shapeOf(fixture.overlap.recipeIds)).toEqual(firstOverlap);
        expect(await tableCounts()).toEqual(firstCounts);
        expect(rerun).toEqual(fixture);
    }, 120_000);

    it('mints ids that are stable across runs, so the fixture and the k6 script cannot drift', () => {
        expect(fixture.fanout.recipeIds[0]).toBe(fanoutRecipeId(0));
        expect(fixture.fanout.recipeIds).toHaveLength(FANOUT_RECIPE_COUNT);
        expect(fixture.overlap.recipeIds[0]).toBe(overlapRecipeId(0));
        expect(fixture.overlap.recipeIds).toHaveLength(FANOUT_RECIPE_COUNT);
        expect(new Set(fixture.fanout.recipeIds)).not.toContain(overlapRecipeId(0));
    });

    // ⚠️ LAST on purpose: it deletes the fixture the tests above read. `afterAll` deletes again, which is then a
    // no-op — and that second run is itself the proof that the cleanup tolerates a world that is already clean.
    it('cleanup removes every row the fixture wrote, and nothing else', async () => {
        await deleteNutritionFanoutFixture(pool);

        const { rows } = await pool.query<{ recipes: number; lookups: number }>(
            `SELECT (SELECT count(*) FROM recipes      WHERE id = ANY($1::uuid[]))::int AS recipes,
                    (SELECT count(*) FROM food_lookups WHERE id = ANY($2::uuid[]))::int AS lookups`,
            [fixtureRecipeIds(), fixtureLookupIds()],
        );

        expect(rows[0]).toEqual({ recipes: 0, lookups: 0 });
        // Back to the counts from before the seed: every fixture row is gone (above), so equal totals mean no
        // row that was not the fixture's went with them.
        expect(await tableCounts()).toEqual(before);
    });
});
