/**
 * LOCAL e2e: the nutrient dictionary and a root's nutrition aggregate, through their gateways, as `food_app` on a
 * database migrated by food's own runner (T-107, curated catalog plan U4, KTD-19, KTD-23).
 *
 * What a mock cannot show lives here: the dictionary's unique keys, the root arm's partial unique index under a
 * repeated header create, the citation's unique key under a repeated cite, the `amount >= 0` CHECK, and the "uncited
 * means authored" assertion trigger judging an author's values. The pure tag lookup is unit-tested beside the DAO.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthoredFoodsDao } from '../../src/foods/dao/authoredFoods.dao.js';
import { isNutrientDefinitionMismatchError } from '../../src/foods/dao/dao.errors.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodNutritionDao } from '../../src/foods/dao/foodNutrition.dao.js';
import { NutrientDao } from '../../src/foods/dao/nutrient.dao.js';
import { makeDb, type TestDb } from '../support/db.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';

/**
 * The SQLSTATE a rejected promise carries, walking Drizzle's `cause` chain.
 *
 * @param pending - The operation.
 * @returns The SQLSTATE, `'none'` when the rejection carries none, or `undefined` when the operation succeeded.
 */
async function sqlStateOfRejection(pending: Promise<unknown>): Promise<string | undefined> {
    try {
        await pending;

        return undefined;
    } catch (error) {
        let candidate: unknown = error;

        for (let depth = 0; depth < 5 && typeof candidate === 'object' && candidate !== null; depth += 1) {
            if ('code' in candidate && typeof candidate.code === 'string') {
                return candidate.code;
            }

            candidate = 'cause' in candidate ? candidate.cause : undefined;
        }

        return 'none';
    }
}

describe.skipIf(!hasTestDatabase)('the nutrient dictionary and the nutrition aggregate', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let nutrients: NutrientDao;
    let nutrition: FoodNutritionDao;
    let authored: AuthoredFoodsDao;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
        db = makeDb(pool);
        foods = new FoodDao(db);
        nutrients = new NutrientDao(db);
        nutrition = new FoodNutritionDao(db);
        authored = new AuthoredFoodsDao(db);
    });

    beforeEach(async () => {
        await foodE2eDb().truncate();
    });

    afterAll(async () => {
        await pool?.end();
        await foodE2eDb().truncate();
    });

    /** Count rows of one query. */
    const countOf = async (sql: string, params: readonly unknown[] = []): Promise<number> => {
        const { rows } = await pool.query<{ count: string }>(sql, [...params]);

        return Number(rows[0]?.count);
    };

    describe('NutrientDao.resolveOrCreate — one dictionary entry per definition (DB-5, KTD-23)', () => {
        it('collapses one (name, unit) to one nutrient_id whether or not the caller states its tag', async () => {
            const withTag = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g', infoodsTag: 'PROCNT' });
            const withoutTag = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g', infoodsTag: null });

            expect(withoutTag.id).toBe(withTag.id);
            expect(await countOf(`SELECT count(*) AS count FROM nutrient WHERE name = 'Protein' AND unit = 'g'`)).toBe(
                1,
            );
        });

        it('stores the mapped tag for a pair the caller states no tag for, and none for an unmapped pair', async () => {
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });
            const atwater = await nutrients.resolveOrCreate({ name: 'Energy (atwater general factors)', unit: 'kcal' });
            const vitaminC = await nutrients.resolveOrCreate({ name: 'Vitamin C, total ascorbic acid', unit: 'mg' });

            expect([protein.infoodsTag, atwater.infoodsTag, vitaminC.infoodsTag]).toStrictEqual(['PROCNT', null, null]);
        });

        it('refuses a tag that disagrees with the mapping, and writes nothing', async () => {
            const refused = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g', infoodsTag: 'FAT' }).then(
                () => undefined,
                (error: unknown) => error,
            );

            expect(isNutrientDefinitionMismatchError(refused)).toBe(true);
            expect(await countOf('SELECT count(*) AS count FROM nutrient')).toBe(0);
        });

        it('resolves a stated tag to the entry that carries it', async () => {
            const kcal = await nutrients.resolveOrCreate({ name: 'Energy', unit: 'kcal' });
            const byTag = await nutrients.resolveOrCreate({ name: 'Energy', unit: 'kcal', infoodsTag: 'ENERC_KCAL' });

            expect(byTag.id).toBe(kcal.id);
        });

        it('gives distinct (name, unit) pairs distinct nutrient_ids', async () => {
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });
            const energy = await nutrients.resolveOrCreate({ name: 'Energy', unit: 'kcal' });

            expect(protein.id).not.toBe(energy.id);
        });
    });

    describe("FoodNutritionDao — a live root's header, citations and values (KTD-19)", () => {
        it('creates one header per root, and returns the same one again', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'almonds' });
            const first = await nutrition.headerForFood(foodId);
            const second = await nutrition.headerForFood(foodId);

            expect(second).toBe(first);
            expect(await countOf('SELECT count(*) AS count FROM food_nutrition')).toBe(1);
        });

        it('cites one source item once, and overwrites the winning value and its citation', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'cashews' });
            const header = await nutrition.headerForFood(foodId);
            const citeA = await nutrition.citeSourceItem(header, { dataset: 'usdaSrFoundation', externalKey: 'A' });
            const citeAgain = await nutrition.citeSourceItem(header, { dataset: 'usdaSrFoundation', externalKey: 'A' });
            const citeB = await nutrition.citeSourceItem(header, { dataset: 'usdaBranded', externalKey: 'B' });
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });

            expect(citeAgain).toBe(citeA);
            expect(await countOf('SELECT count(*) AS count FROM food_nutrition_citation')).toBe(2);

            await nutrition.upsertValue({
                nutritionId: header,
                nutrientId: protein.id,
                amount: '21.15',
                citationId: citeA,
            });
            await nutrition.upsertValue({
                nutritionId: header,
                nutrientId: protein.id,
                amount: '20.00',
                citationId: citeB,
            });

            expect(await nutrition.listByFood(foodId)).toStrictEqual([
                { nutrientId: protein.id, amount: '20.00', trace: false, basis: 'per_100g', citationId: citeB },
            ]);
        });

        it('refuses a second citation of one (header, dataset, key), so a racing cite cannot duplicate it', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'pistachios' });
            const header = await nutrition.headerForFood(foodId);

            await nutrition.citeSourceItem(header, { dataset: 'usdaSrFoundation', externalKey: 'K' });

            expect(
                await sqlStateOfRejection(
                    pool.query(
                        `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
                         VALUES ('racer', $1, 'usdaSrFoundation', 'K', 'exact')`,
                        [header],
                    ),
                ),
            ).toBe('23505');
        });

        it('refuses a negative amount (CHECK amount >= 0, DB-6)', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'hazelnuts' });
            const header = await nutrition.headerForFood(foodId);
            const cite = await nutrition.citeSourceItem(header, { dataset: 'usdaSrFoundation', externalKey: 'P' });
            const fat = await nutrients.resolveOrCreate({ name: 'Total lipid (fat)', unit: 'g' });

            expect(
                await sqlStateOfRejection(
                    nutrition.upsertValue({ nutritionId: header, nutrientId: fat.id, amount: '-1', citationId: cite }),
                ),
            ).toBe('23514');
        });
    });

    describe("FoodNutritionDao.replaceAuthoredValues — an author's own uncited values (ADR-0029)", () => {
        const macros = { calories: 100, proteinG: 1, carbsG: 2, fatG: 3 };

        it('replaces every value wholesale, leaving each uncited', async () => {
            const created = await authored.createAuthored({
                userId: 'user_author',
                name: 'Granola',
                normalizedName: 'granola',
                description: null,
                macros,
                portions: [],
            });
            const foodId = created.kind === 'created' ? created.id : created.existingId;
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });
            const fibre = await nutrients.resolveOrCreate({ name: 'Fiber, total dietary', unit: 'g' });

            await nutrition.replaceAuthoredValues(foodId, [
                { nutrientId: protein.id, amount: '9' },
                { nutrientId: fibre.id, amount: '4.5' },
            ]);

            const stored = await nutrition.listByFood(foodId);

            expect(stored.map((value) => [value.nutrientId, value.amount, value.citationId]).sort()).toStrictEqual(
                [
                    [protein.id, '9', null],
                    [fibre.id, '4.5', null],
                ].sort(),
            );
        });

        it('is refused by the assertion trigger under a live food, which writes nothing uncited', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'oats' });
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });

            expect(
                await sqlStateOfRejection(
                    nutrition.replaceAuthoredValues(foodId, [{ nutrientId: protein.id, amount: '9' }]),
                ),
            ).toBe('23000');
            expect(await countOf('SELECT count(*) AS count FROM food_nutrition_value')).toBe(0);
        });
    });
});
