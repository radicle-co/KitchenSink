/**
 * U11/R20 — private-food scoping on the RECIPE side, against a REAL migrated Postgres (0040, re-grained by 0051).
 *
 * The food service refuses a stranger's retrieval of a private authored food at its own search predicate;
 * this suite proves the recipe-side facts the same boundary still rests on:
 *
 *   - **Schema** — the author's ULID lives on the BINDING (`food_lookups.food_owner_id`, 0051) with its partial
 *     index, and `ingredient_resolutions.author_augmented` (0040) exists with the shape the code assumes. A unit
 *     test cannot observe a migration that did not apply.
 *   - **Correction reach** — `findWriteFacts.correctedFoodIsPrivate` reads the privacy fact from the real
 *     binding row, which is what clamps a curator grant / corroboration pair to author scope in the policy.
 *   - **Resolution provenance** — `author_augmented` round-trips through record → latestResolutionsByLookupIds,
 *     which is what carries the band-statistics exclusion to the verification producer.
 *
 * ⚠️ REWRITTEN (plan 002): three cases were REMOVED because their subject no longer exists in this service, not
 * because they failed. Where each behaviour went:
 *
 *   - "local search never shows a stranger a private food name" — the recipe-side name catalog and its search
 *     are gone (0051). The picker searches food-service, whose `tests/foodSearch.dao.integration.test.ts`
 *     ("a stranger's search sees CATALOG rows only") owns that refusal; the recipe side's remaining half, which
 *     BINDINGS a caller may see, is `tests/e2e/foodLookupsDal.e2e.test.ts` ("privacy of bound roots (R20)").
 *   - "createFoodBacked stores the admitting author" — the capture moved to `FoodLookupsDal.findOrCreateBoundRoot`,
 *     proved by the same e2e case (a private binding is shown to its author only).
 *   - "updateResolution: a ULID sets, null clears, undefined leaves untouched" — a found binding is NEVER updated
 *     (R13), so there is no refresh path to write an owner; the e2e "never updates a lookup it finds (R13)" case
 *     is its successor.
 *
 * Every row this suite writes is scoped by its own food ids and phrase, and removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { ensureFoodLookup } from '../../../tests/support/lineChain.js';
import { hasTestDatabase, recipeDb } from '../../../tests/support/roleDb.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const roleDb = recipeDb();

/** Whether a test database is configured. */
const hasDatabaseUrl = hasTestDatabase;

const AUTHOR = '01JU11AUTHOR00000000000AAA';
const PRIVATE_FOOD = '01JU11FOOD0000000000PRIVAT';
const PUBLIC_FOOD = '01JU11FOOD0000000000PUBLIC';
const SUITE_FOODS = [PRIVATE_FOOD, PUBLIC_FOOD];

describe.skipIf(!hasDatabaseUrl)('U11/R20 private-food scoping (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let privateLookupId: string;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);

        privateLookupId = await ensureFoodLookup(pool, { arm: 'private', foodId: PRIVATE_FOOD, ownerId: AUTHOR });
        await ensureFoodLookup(pool, { arm: 'shared', foodId: PUBLIC_FOOD });
    });

    afterAll(async () => {
        // `ingredient_resolutions` cascades from its binding (0051), so deleting the bindings takes the events too.
        await pool.query('DELETE FROM food_lookups WHERE food_id = ANY($1)', [SUITE_FOODS]);
        await pool.end();
    });

    describe('the schema, as migrated', () => {
        it('food_lookups.food_owner_id is a nullable varchar with a partial index', async () => {
            const column = await pool.query(
                `SELECT data_type, is_nullable FROM information_schema.columns
                 WHERE table_name = 'food_lookups' AND column_name = 'food_owner_id'`,
            );

            expect(column.rows).toHaveLength(1);
            expect(column.rows[0]).toEqual({ data_type: 'character varying', is_nullable: 'YES' });

            const index = await pool.query<{ indexdef: string }>(
                `SELECT indexdef FROM pg_indexes
                 WHERE tablename = 'food_lookups' AND indexname = 'idx_food_lookups_food_owner'`,
            );

            expect(index.rows).toHaveLength(1);
            expect(index.rows[0]?.indexdef).toContain('WHERE (food_owner_id IS NOT NULL)');
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

    describe('correction reach — findWriteFacts reads the privacy fact from the real binding', () => {
        it('answers true for a private food and false for a catalog one', async () => {
            const mappings = new ResolutionMappingsDal(db);
            const key = normalizedIngredientKey('grandma blend');

            if (key === undefined) {
                throw new Error('fixture phrase must normalize');
            }

            const privateFacts = await mappings.findWriteFacts(key, AUTHOR, PRIVATE_FOOD, {
                excludeTestPrincipals: true,
            });
            const publicFacts = await mappings.findWriteFacts(key, AUTHOR, PUBLIC_FOOD, {
                excludeTestPrincipals: true,
            });

            expect(privateFacts.correctedFoodIsPrivate).toBe(true);
            expect(publicFacts.correctedFoodIsPrivate).toBe(false);
        });
    });

    describe('resolution provenance — author_augmented round-trips', () => {
        it('record → latestResolutionsByLookupIds carries the flag', async () => {
            const resolutions = new IngredientResolutionsDal(db);

            await resolutions.record({ foodLookupId: privateLookupId, tier: 'lexical', authorAugmented: true });

            const latest = await resolutions.latestResolutionsByLookupIds([privateLookupId]);

            expect(latest.get(privateLookupId)?.authorAugmented).toBe(true);
        });
    });
});
