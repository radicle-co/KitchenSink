/**
 * Integration suite for the BATCHED nutrition read — `food_nutrient_view` + {@link FoodDao.readNutritionBatch}
 * — against a real Postgres.
 *
 * ## What this tier exists to prove, that no mocked test can
 *
 * | Claim | Why only a real database settles it |
 * | ----- | ----------------------------------- |
 * | the migration CREATEs `food_nutrient_view` with exactly the five carried columns | a unit test cannot observe a migration that did not apply |
 * | the view carries `basis` THROUGH — it never filters, names or unit-matches | the stored view definition is the only place a second selection authority could hide |
 * | the batched read returns what the per-id reads returned before it | equivalence against the code path it replaces, on the same rows |
 * | a 100-id request costs 3 statements, not ~500 | the whole reason this work exists; only the driver can count them |
 * | `numeric` arrives as a STRING | node-postgres' numeric mapping is a driver behaviour; drop the `Number(...)` seam and every calorie is `NaN` |
 *
 * ⛔ The view is an ACCESS PATH and nothing else. `LABEL_NUTRIENT_MAP` (kcal, not kJ) and `selectPer100g`
 * (basis AND canonical name AND unit) remain the ONE authority on which row is a calorie figure. A
 * column-shaped view — `max(amount) FILTER (WHERE n.name = 'Energy' AND n.unit = 'kcal')` — would re-express
 * that rule in SQL, where it can drift from the TypeScript one, and the 4.184× error the map exists to
 * prevent comes back with nothing looking wrong. The guard is the pair of tests below that read the STORED
 * view definition and assert a `per_serving` row survives it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getViewSelectedFields } from 'drizzle-orm';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { foodNutrientView } from '../src/db/schema/index.js';
import { newFoodId } from '../src/db/ulid.js';
import { makeCatalogFood } from './__fixtures__/catalogFood.js';
import { makeDb, makePool, type TestDb } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';

/** One nutrient value to seed, in stored (string-amount) form. */
interface SeedNutrient {
    readonly name: string;
    readonly unit: string;
    readonly amount: string;
    readonly basis?: 'per_100g' | 'per_serving';
}

/** One portion to seed. */
interface SeedPortion {
    readonly label: string;
    readonly gramWeight: string;
}

/** Everything one seeded food carries. */
interface SeedFood {
    readonly name: string;
    readonly status?: string;
    /** An author and visibility make it an authored food; `user_id` is fixed at insert (0018). */
    readonly userId?: string;
    readonly visibility?: 'private' | 'promoted';
    readonly nutrients?: readonly SeedNutrient[];
    readonly portions?: readonly SeedPortion[];
}

describe.skipIf(!hasTestDatabase)('batched nutrition read (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: FoodDao;

    /**
     * Seed one food with its crosswalk row, nutrient values and portions.
     *
     * @param seed - The food to write.
     * @returns The food's internal id.
     * @sideEffect Inserts into `food_item`, `food`, `food_sources`, `nutrient`, the nutrition aggregate and
     *   `food_portions`.
     */
    async function seedFood(seed: SeedFood): Promise<string> {
        const sourceId = newFoodId();
        const { id: foodId, itemId } = await makeCatalogFood(pool, {
            id: newFoodId(),
            name: seed.name,
            status: seed.status ?? 'RESOLVED',
            userId: seed.userId ?? null,
            ...(seed.visibility === undefined ? {} : { visibility: seed.visibility }),
        });
        const externalKey = `key-${foodId}`;

        await pool.query('INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, $3, $4)', [
            sourceId,
            itemId,
            'usda',
            externalKey,
        ]);

        const nutritionId = newFoodId();
        const citationId = newFoodId();

        if ((seed.nutrients ?? []).length > 0) {
            await pool.query('INSERT INTO food_nutrition (id, food_id) VALUES ($1, $2)', [nutritionId, foodId]);
            await pool.query(
                `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
                 VALUES ($1, $2, 'usdaSrFoundation', $3, 'exact')`,
                [citationId, nutritionId, externalKey],
            );
        }

        for (const value of seed.nutrients ?? []) {
            // The dictionary is shared and the service only inserts into it (KTD-14).
            await pool.query('INSERT INTO nutrient (id, name, unit) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
                newFoodId(),
                value.name,
                value.unit,
            ]);
            const dictionary = await pool.query<{ id: string }>(
                'SELECT id FROM nutrient WHERE name = $1 AND unit = $2',
                [value.name, value.unit],
            );

            await pool.query(
                `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
                 VALUES ($1, $2, $3, $4::nutrient_basis, $5)`,
                [nutritionId, dictionary.rows[0]!.id, value.amount, value.basis ?? 'per_100g', citationId],
            );
        }

        for (const portion of seed.portions ?? []) {
            await pool.query(
                'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, $3, $4, $5)',
                [newFoodId(), itemId, portion.label, portion.gramWeight, sourceId],
            );
        }

        return foodId;
    }

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        dao = new FoodDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    // ── The migrated object itself ──────────────────────────────────────────────────────────────────
    describe('the view (0006, rebuilt over the nutrition aggregate by 0018)', () => {
        it('creates `food_nutrient_view` as a plain (NON-materialized) view', async () => {
            const { rows } = await pool.query<{ table_name: string }>(
                `SELECT table_name FROM information_schema.views
                 WHERE table_schema = 'public' AND table_name = 'food_nutrient_view'`,
            );

            expect(rows).toHaveLength(1);

            // ⛔ Not a matview, deliberately. Food's writer is user-triggered and latency-visible: a user adds
            // an ingredient, food answers 202, the USDA fetch fills it, and the user is polling. A matview
            // would report no nutrition for the food that was JUST resolved — the one moment that matters.
            const matview = await pool.query(
                `SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'food_nutrient_view'`,
            );

            expect(matview.rowCount).toBe(0);
        });

        it('carries exactly its columns, both owner arms included, and the drizzle declaration mirrors them', async () => {
            const { rows } = await pool.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'food_nutrient_view'
                 ORDER BY ordinal_position`,
            );

            expect(rows.map((row) => row.column_name)).toStrictEqual([
                'food_id',
                'food_variant_id',
                'nutrient',
                'infoods_tag',
                'unit',
                'basis',
                'amount',
                'trace',
                'dataset',
            ]);

            // The drizzle view is the ORM's mirror of that DDL; a column added to one and not the other is a
            // silent `undefined` at the read seam rather than a compile error.
            const declared = Object.values(getViewSelectedFields(foodNutrientView)).map(
                (column) => (column as { name: string }).name,
            );

            expect(declared.sort()).toStrictEqual([...rows.map((row) => row.column_name)].sort());
        });

        it('⛔ the view NAMES an access path and makes NO selection decision', async () => {
            const { rows } = await pool.query<{ definition: string }>(
                `SELECT pg_get_viewdef('food_nutrient_view'::regclass, true) AS definition`,
            );
            const definition = rows[0]!.definition.toLowerCase();

            // Any of these means the kcal-vs-kJ rule now lives in TWO places (SQL and LABEL_NUTRIENT_MAP),
            // free to drift, and the divergence renders as a plausible calorie count.
            expect(definition).not.toContain('filter');
            expect(definition).not.toContain('energy');
            expect(definition).not.toContain('kcal');
            expect(definition).not.toContain('per_100g');
            expect(definition).not.toContain('µ');
            expect(definition).not.toContain('case');
        });

        it('⛔ carries `basis` THROUGH — a per_serving row is visible in the view, not filtered out of it', async () => {
            const id = await seedFood({
                name: 'branded bar',
                nutrients: [
                    { name: 'Energy', unit: 'kcal', amount: '190', basis: 'per_serving' },
                    { name: 'Protein', unit: 'g', amount: '10' },
                ],
            });

            const { rows } = await pool.query<{ nutrient: string; basis: string }>(
                'SELECT nutrient, basis FROM food_nutrient_view WHERE food_id = $1 ORDER BY nutrient',
                [id],
            );

            // A view that pre-filtered to per_100g would return one row here and the per-serving trap would
            // become invisible to `selectPer100g` — which is the layer that must decide, and report ABSENT.
            expect(rows).toStrictEqual([
                { nutrient: 'Energy', basis: 'per_serving' },
                { nutrient: 'Protein', basis: 'per_100g' },
            ]);
        });
    });

    // ── Equivalence with the per-id path it replaces ────────────────────────────────────────────────
    describe('readNutritionBatch — equivalence with the per-id reads it replaces', () => {
        it('returns, for a mixed corpus, exactly what `readGoldenRecord` returned per id', async () => {
            const ids = await Promise.all([
                seedFood({
                    name: 'broccoli',
                    nutrients: [
                        { name: 'Energy', unit: 'kcal', amount: '34' },
                        { name: 'Energy', unit: 'kJ', amount: '142' },
                        { name: 'Protein', unit: 'g', amount: '2.8' },
                        { name: 'Fatty acids, total trans', unit: 'g', amount: '0' },
                    ],
                    portions: [
                        { label: '1 cup chopped', gramWeight: '91' },
                        { label: '1 spear', gramWeight: '31' },
                    ],
                }),
                seedFood({
                    name: 'branded bar',
                    nutrients: [{ name: 'Energy', unit: 'kcal', amount: '190', basis: 'per_serving' }],
                    portions: [],
                }),
                seedFood({ name: 'bare pending', status: 'PENDING' }),
                seedFood({ name: 'portions only', portions: [{ label: '1 tablespoon', gramWeight: '15' }] }),
            ]);

            const batched = await dao.readNutritionBatch(ids);
            const byId = new Map(batched.map((record) => [record.id, record]));

            for (const id of ids) {
                const golden = (await dao.readGoldenRecord(id))!;
                const record = byId.get(id);

                expect(record?.status).toBe(golden.status);
                // Same rows, same values — compared unordered, since only the portion order is behaviourally
                // load-bearing (it is asserted directly below).
                expect([...(record?.nutrients ?? [])].sort(byNutrientKey)).toStrictEqual(
                    golden.nutrients
                        .map((nutrient) => ({
                            nutrient: nutrient.name,
                            unit: nutrient.unit,
                            basis: nutrient.basis,
                            amount: nutrient.amount,
                            infoodsTag: nutrient.infoodsTag,
                            // The golden read carries numbers only; these seeds state no trace.
                            trace: false,
                        }))
                        .sort(byNutrientKey),
                );
                expect(record?.portions).toStrictEqual(
                    golden.portions.map((portion) => ({ label: portion.label, gramWeight: portion.gramWeight })),
                );
            }
        });

        it('keeps each food`s portions in INSERTION order even after the heap order has been disturbed', async () => {
            // `normalizePortions` de-duplicates by unit FIRST-WINS, so portion order is not cosmetic: it
            // decides what a `cup` of this food weighs. Nothing in `WHERE food_id = ANY(...)` promises an
            // order — rows arrive in HEAP order, which equals insertion order only until a row is rewritten.
            //
            // The UPDATE below is what makes this test able to fail: MVCC writes a new tuple version at the
            // end of the heap, so an unordered read returns `2 cups sliced` LAST and a `cup` silently becomes
            // 120 g instead of 125 g — identically for every caller, and cached at the edge (ADR-0020).
            // Ordering by the ULID `food_portions.id` pins insertion order regardless.
            const id = await seedFood({
                name: 'ordered portions',
                portions: [
                    { label: '2 cups sliced', gramWeight: '250' },
                    { label: '1/2 cup diced', gramWeight: '60' },
                    { label: '1 tablespoon', gramWeight: '15' },
                ],
            });
            const filler = await Promise.all(
                Array.from({ length: 20 }, (_, index) =>
                    seedFood({ name: `filler ${index}`, portions: [{ label: '1 gram', gramWeight: '1' }] }),
                ),
            );

            await pool.query(
                `UPDATE food_portions SET label = label
                  WHERE item_id = (SELECT item_id FROM food WHERE id = $1) AND label = $2`,
                [id, '2 cups sliced'],
            );

            const records = await dao.readNutritionBatch([id, ...filler].sort());
            const record = records.find((candidate) => candidate.id === id);

            expect(record?.portions.map((portion) => portion.label)).toStrictEqual([
                '2 cups sliced',
                '1/2 cup diced',
                '1 tablespoon',
            ]);
        });

        it('⛔ NO authored food enters the shared batch — catalog rows only (ADR-0036)', async () => {
            // ⚠️ This REVERSES what the case here used to assert. It read "a PROMOTED authored food ENTERS
            // the batch", on the reasoning that a promoted food is world-readable and its nutrition does not
            // vary by caller, so ADR-0020's objection to authored rows in a URL-keyed shared cache did not
            // apply. Promotion is removed (owner ruling, 2026-09-07): an authored food is AUTHOR-ONLY, so
            // there is no longer any authored row whose nutrition is caller-invariant, and the predicate is
            // now simply `user_id IS NULL`.
            //
            // Both rows are seeded with the `promoted` visibility VALUE on purpose. It is still admissible
            // on the column (Postgres cannot remove an enum value, and leaving it valid keeps the door open
            // to lifting the restriction without a migration), so the value existing must NOT be enough to
            // re-admit a row to the shared cache. This is the assertion that catches a partial revert.
            // Authored at insert: `user_id` is fixed after it (0018).
            const stillMarkedPromoted = await seedFood({
                name: 'promoted blend',
                userId: 'author-a',
                visibility: 'promoted',
            });
            const privateFood = await seedFood({ name: 'private blend', userId: 'author-a', visibility: 'private' });

            expect(await dao.readNutritionBatch([stillMarkedPromoted, privateFood])).toStrictEqual([]);
        });

        it('omits an id that names no food, and returns a food that has no nutrition at all', async () => {
            const bare = await seedFood({ name: 'bare failed', status: 'FAILED' });
            const ghost = newFoodId();

            const records = await dao.readNutritionBatch([bare, ghost].sort());

            expect(records.map((record) => record.id)).toStrictEqual([bare]);
            expect(records[0]).toStrictEqual({ id: bare, status: 'FAILED', nutrients: [], portions: [] });
        });

        // Rewritten for curated plan U8 S1: a trace row now reaches the reader, because carbohydrate counts it as 0
        // (KTD-23). What R53 still forbids is reading the MARK as a number — the row arrives with a NULL amount and
        // `trace: true`, and `nutrientSelection.ts` is the one place that decides what each macro makes of it.
        it('⛔ carries a trace mark as a mark — NULL amount, `trace: true` — never as a number (R53)', async () => {
            const id = await seedFood({ name: 'traced', nutrients: [{ name: 'Protein', unit: 'g', amount: '3' }] });

            await pool.query(
                `INSERT INTO nutrient (id, name, unit) VALUES ($1, 'Fiber, total dietary', 'g') ON CONFLICT DO NOTHING`,
                [newFoodId()],
            );
            await pool.query(
                `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, trace, basis, citation_id)
                 SELECT h.id, n.id, NULL, true, 'per_100g', c.id
                   FROM food_nutrition h JOIN food_nutrition_citation c ON c.nutrition_id = h.id
                   JOIN nutrient n ON n.name = 'Fiber, total dietary' AND n.unit = 'g'
                  WHERE h.food_id = $1`,
                [id],
            );

            const [record] = await dao.readNutritionBatch([id]);

            expect([...(record?.nutrients ?? [])].sort(byNutrientKey)).toStrictEqual(
                [
                    {
                        nutrient: 'Fiber, total dietary',
                        unit: 'g',
                        basis: 'per_100g',
                        amount: null,
                        infoodsTag: expect.toBeOneOf([null, 'FIBTG']),
                        trace: true,
                    },
                    {
                        nutrient: 'Protein',
                        unit: 'g',
                        basis: 'per_100g',
                        amount: '3',
                        infoodsTag: expect.toBeOneOf([null, 'PROCNT']),
                        trace: false,
                    },
                ].sort(byNutrientKey),
            );
        });

        it('reads nothing at all for an empty id list', async () => {
            await seedFood({ name: 'present but unasked' });

            expect(await dao.readNutritionBatch([])).toStrictEqual([]);
        });
    });

    // ── The point of the whole exercise ─────────────────────────────────────────────────────────────
    describe('statement count', () => {
        it('⛔ answers 100 ids in 3 statements, where the per-id path needs 1+4 EACH', async () => {
            const ids = (
                await Promise.all(
                    Array.from({ length: 100 }, (_, index) =>
                        seedFood({
                            name: `counted ${index}`,
                            nutrients: [{ name: 'Energy', unit: 'kcal', amount: String(index) }],
                            portions: [{ label: '1 cup', gramWeight: '100' }],
                        }),
                    ),
                )
            ).sort();

            const counted = new CountingLogger();
            const countedDao = new FoodDao(makeDb(pool, counted));

            counted.reset();
            await countedDao.readNutritionBatch(ids);
            const batchedStatements = counted.count;

            counted.reset();
            await Promise.all(ids.map((id) => countedDao.readGoldenRecord(id)));
            const perIdStatements = counted.count;

            expect(batchedStatements).toBe(3);
            // The baseline is asserted too, so this test still means something if `readGoldenRecord` is ever
            // itself batched: 100 ids x (1 food row + 5 aggregate reads — the fifth is U5's consumption
            // prior, carried on the golden record for recipe-service's capture).
            expect(perIdStatements).toBe(600);
        });
    });

    // ── The driver seam that turns every calorie into NaN if it is dropped ──────────────────────────
    describe('numeric → string', () => {
        it('returns `amount` and `gram_weight` as STRINGS at full stored precision', async () => {
            const id = await seedFood({
                name: 'precise',
                nutrients: [{ name: 'Energy', unit: 'kcal', amount: '123.456789012345678901' }],
                portions: [{ label: '1 cup', gramWeight: '90.5' }],
            });

            const [record] = await dao.readNutritionBatch([id]);

            expect(typeof record!.nutrients[0]!.amount).toBe('string');
            expect(record!.nutrients[0]!.amount).toBe('123.456789012345678901');
            expect(typeof record!.portions[0]!.gramWeight).toBe('string');
            expect(record!.portions[0]!.gramWeight).toBe('90.5');
        });
    });
});

/** Stable comparison key for an unordered nutrient-row comparison. */
function byNutrientKey(left: { nutrient: string; unit: string }, right: { nutrient: string; unit: string }): number {
    return `${left.nutrient}|${left.unit}`.localeCompare(`${right.nutrient}|${right.unit}`);
}

/** Counts the statements Drizzle sends, so "3 queries, not ~500" is measured rather than asserted. */
class CountingLogger {
    public count = 0;

    /**
     * Record one statement.
     *
     * @sideEffect Increments {@link CountingLogger.count}.
     */
    public logQuery(): void {
        this.count += 1;
    }

    /**
     * Zero the counter between measurements.
     *
     * @sideEffect Resets {@link CountingLogger.count}.
     */
    public reset(): void {
        this.count = 0;
    }
}
