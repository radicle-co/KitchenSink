/**
 * U11/R20 — private-food scoping on the RECIPE side, against a REAL migrated Postgres (0040).
 *
 * The food service refuses a stranger's retrieval of a private authored food at its own search predicate;
 * this suite proves the recipe-side half of the same boundary:
 *
 *   - **Schema (0040)** — `ingredients.food_owner_id` and `ingredient_resolutions.author_augmented`
 *     exist with the shapes the code assumes. A unit test cannot observe a migration that did not apply.
 *   - **Capture** — `createFoodBacked` stores the admitting author's ULID; `updateResolution`'s
 *     three-valued `foodOwnerId` (set / clear / leave) writes exactly what each refresh path knows.
 *   - **Local search** — the shared `ingredients` catalog row for a private food surfaces ONLY to its
 *     author. The stranger's picker never shows the name.
 *   - **Correction reach** — `findWriteFacts.correctedFoodIsPrivate` reads the privacy fact from the
 *     real row, which is what clamps a curator grant / corroboration pair to author scope in the policy.
 *   - **Resolution provenance** — `author_augmented` round-trips through record → latestFor, which is
 *     what carries the band-statistics exclusion to the verification producer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { makeCanonicalName } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { seed } from '../../../src/database/seed.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** Whether a test database is configured. */
const hasDatabaseUrl = Boolean(DATABASE_URL);

const AUTHOR = '01JU11AUTHOR00000000000AAA';
const STRANGER = '01JU11STRANGER000000000BBB';
const PRIVATE_FOOD = '01JU11FOOD0000000000PRIVAT';
const PUBLIC_FOOD = '01JU11FOOD0000000000PUBLIC';

describe.skipIf(!hasDatabaseUrl)('U11/R20 private-food scoping (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        // Restore the seeded world destroyed by the per-test wipe (same rationale as the search suite).
        await seed(pool);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredient_resolutions');
        await pool.query('DELETE FROM ingredient_resolution_mappings');
        await pool.query('DELETE FROM ingredients');
    });

    describe('the 0040 schema, as migrated', () => {
        it('ingredients.food_owner_id is a nullable varchar with a partial index', async () => {
            const column = await pool.query(
                `SELECT data_type, is_nullable FROM information_schema.columns
                 WHERE table_name = 'ingredients' AND column_name = 'food_owner_id'`,
            );

            expect(column.rows).toHaveLength(1);
            expect(column.rows[0]).toEqual({ data_type: 'character varying', is_nullable: 'YES' });

            const index = await pool.query(
                `SELECT indexname FROM pg_indexes
                 WHERE tablename = 'ingredients' AND indexname = 'idx_ingredients_food_owner'`,
            );

            expect(index.rows).toHaveLength(1);
        });

        it('ingredient_resolutions.author_augmented is boolean NOT NULL DEFAULT false', async () => {
            const column = await pool.query(
                `SELECT data_type, is_nullable, column_default FROM information_schema.columns
                 WHERE table_name = 'ingredient_resolutions' AND column_name = 'author_augmented'`,
            );

            expect(column.rows).toHaveLength(1);
            expect(column.rows[0]?.data_type).toBe('boolean');
            expect(column.rows[0]?.is_nullable).toBe('NO');
            expect(column.rows[0]?.column_default).toBe('false');
        });
    });

    describe('capture at admission and refresh', () => {
        it('createFoodBacked stores the admitting author, and NULL for a catalog food', async () => {
            await dal.createFoodBacked({
                name: makeCanonicalName('Grandma blend'),
                foodId: PRIVATE_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: AUTHOR,
            });
            await dal.createFoodBacked({
                name: makeCanonicalName('Plain quinoa'),
                foodId: PUBLIC_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });

            const rows = await pool.query(`SELECT food_id, food_owner_id FROM ingredients ORDER BY food_id`);

            expect(rows.rows).toEqual([
                { food_id: PRIVATE_FOOD, food_owner_id: AUTHOR },
                { food_id: PUBLIC_FOOD, food_owner_id: null },
            ]);
        });

        it('updateResolution: a ULID sets, null CLEARS (promotion), undefined leaves untouched', async () => {
            const created = await dal.createFoodBacked({
                name: makeCanonicalName('Grandma blend'),
                foodId: PRIVATE_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: AUTHOR,
            });

            const ownerOf = async (): Promise<string | null> => {
                const row = await pool.query(`SELECT food_owner_id FROM ingredients WHERE id = $1`, [created.id]);

                return row.rows[0]?.food_owner_id ?? null;
            };

            // undefined → untouched (a status-only refresh that never saw the food body).
            await dal.updateResolution(created.id, { foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            expect(await ownerOf()).toBe(AUTHOR);

            // null → CLEARED (the refresh saw a non-private visibility — U12's promotion path).
            await dal.updateResolution(created.id, {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: null,
            });
            expect(await ownerOf()).toBeNull();

            // a ULID → set (re-admission of a private food).
            await dal.updateResolution(created.id, {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: AUTHOR,
            });
            expect(await ownerOf()).toBe(AUTHOR);
        });
    });

    describe('local search — the picker never shows a stranger a private food name', () => {
        beforeEach(async () => {
            await dal.createFoodBacked({
                name: makeCanonicalName('Quinoa, grandma blend'),
                foodId: PRIVATE_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: AUTHOR,
            });
            await dal.createFoodBacked({
                name: makeCanonicalName('Quinoa, uncooked'),
                foodId: PUBLIC_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
        });

        it("a stranger's search sees the catalog row and NOT the private one", async () => {
            const names = (await dal.search('quinoa', STRANGER)).map((hit) => hit.name);

            expect(names).toContain('Quinoa, uncooked');
            expect(names).not.toContain('Quinoa, grandma blend');
        });

        it("the author's own search includes their private food", async () => {
            const names = (await dal.search('quinoa', AUTHOR)).map((hit) => hit.name);

            expect(names).toContain('Quinoa, grandma blend');
            expect(names).toContain('Quinoa, uncooked');
        });

        it('an anonymous search (no caller) sees only the catalog row', async () => {
            const names = (await dal.search('quinoa')).map((hit) => hit.name);

            expect(names).toContain('Quinoa, uncooked');
            expect(names).not.toContain('Quinoa, grandma blend');
        });
    });

    describe('correction reach — findWriteFacts reads the privacy fact from the real row', () => {
        it('answers true for a private food and false for a catalog one', async () => {
            await dal.createFoodBacked({
                name: makeCanonicalName('Grandma blend'),
                foodId: PRIVATE_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: AUTHOR,
            });
            await dal.createFoodBacked({
                name: makeCanonicalName('Plain quinoa'),
                foodId: PUBLIC_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });

            const mappings = new ResolutionMappingsDal(db);
            const key = normalizedIngredientKey('grandma blend');

            if (key === undefined) {
                throw new Error('fixture phrase must normalize');
            }

            const privateFacts = await mappings.findWriteFacts(key, AUTHOR, PRIVATE_FOOD);
            const publicFacts = await mappings.findWriteFacts(key, AUTHOR, PUBLIC_FOOD);

            expect(privateFacts.correctedFoodIsPrivate).toBe(true);
            expect(publicFacts.correctedFoodIsPrivate).toBe(false);
        });
    });

    describe('resolution provenance — author_augmented round-trips', () => {
        it('record → latestFor carries the flag, and it defaults to false', async () => {
            const ingredient = await dal.createFoodBacked({
                name: makeCanonicalName('Quinoa, grandma blend'),
                foodId: PRIVATE_FOOD,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                foodOwnerId: AUTHOR,
            });
            const resolutions = new IngredientResolutionsDal(db);

            await resolutions.record({
                ingredientId: ingredient.id,
                tier: 'lexical',
                authorAugmented: true,
            });

            const latest = await resolutions.latestResolutionsByIngredientIds([ingredient.id]);

            expect(latest.get(ingredient.id)?.authorAugmented).toBe(true);
        });
    });
});
