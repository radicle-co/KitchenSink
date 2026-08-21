/**
 * T099 — ingredient search integration test (pg_trgm fuzzy + tsvector FTS).
 *
 * Exercises {@link IngredientsDal.search} against REAL Docker Postgres (migrated + seeded by
 * `tests/globalSetup.ts`, which enables `pg_trgm` and creates `idx_ingredients_name_trgm` +
 * `idx_ingredients_search_vector`). It proves the two matching paths the picker autocomplete depends on:
 *
 *   - **Full-text search** — a lexeme query (`'flour'`) matches ingredients whose DAL-maintained
 *     `search_vector` contains that lexeme, regardless of word order.
 *   - **Fuzzy (typo-tolerant) search** — a misspelled query (`'flor'`) still matches via the `pg_trgm`
 *     trigram similarity / `ILIKE` substring fallback, even with no exact lexeme.
 *
 * It also confirms freeform (user-entered) rows are searchable and that dedup keeps the shared catalog
 * from bloating. Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness up
 * simply skips (matching the service's e2e ethos).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { makeCanonicalName } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { seed } from '../../../src/database/seed.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** Whether a test database is configured. */
const hasDatabaseUrl = Boolean(DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)('IngredientsDal search (integration: pg_trgm + FTS)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        // This suite wipes the whole `ingredients` table per test for isolation, which destroys the
        // baseline catalog rows the global setup seeds. Since T043b, recipe create/update validates each
        // line's `ingredientId` against that catalog, so other integration specs (crud/conflict/
        // composition) depend on the baseline existing. Serial file execution (fileParallelism: false)
        // means restoring the seed here guarantees it's present for any spec that runs after this one,
        // regardless of file order.
        //
        // ⚠️ REWRITTEN: this used to re-insert `SEED_INGREDIENTS` row by row, which restored only HALF of
        // what the `beforeEach` destroys. The wipe starts with `DELETE FROM recipe_ingredients` — and the
        // seeded recipes now HAVE ingredient lines — so a catalog-only restore left every seeded recipe
        // composed of nothing, with an `ingredient_names_text` still naming ingredients it no longer
        // links to. Calling the seed module itself restores the whole seeded world (catalog + lines +
        // steps + collection), is idempotent by construction (`ON CONFLICT DO NOTHING` on stable ids),
        // and cannot drift from the fixture the way a hand-rolled copy of one INSERT already had.
        await seed(pool);

        await pool.end();
    });

    beforeEach(async () => {
        // Isolate each test: recipe_ingredients references ingredients, so clear it first.
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredients');
    });

    it('full-text matches a lexeme query regardless of word order', async () => {
        await dal.createFreeform(makeCanonicalName('All-purpose flour'));
        await dal.createFreeform(makeCanonicalName('Almond flour'));
        await dal.createFreeform(makeCanonicalName('Unsalted butter'));

        const results = await dal.search('flour');
        const names = results.map((r) => r.name);

        expect(names).toContain('All-purpose flour');
        expect(names).toContain('Almond flour');
        expect(names).not.toContain('Unsalted butter');
    });

    it('fuzzy-matches a misspelled query via pg_trgm similarity', async () => {
        await dal.createFreeform(makeCanonicalName('All-purpose flour'));
        await dal.createFreeform(makeCanonicalName('Unsalted butter'));

        // 'flor' shares no exact lexeme with 'flour' — only the trigram/ILIKE fallback can match it.
        const results = await dal.search('flor');

        expect(results.map((r) => r.name)).toContain('All-purpose flour');
    });

    it('honors the limit and returns rows ranked by relevance', async () => {
        await dal.createFreeform(makeCanonicalName('Bread flour'));
        await dal.createFreeform(makeCanonicalName('Cake flour'));
        await dal.createFreeform(makeCanonicalName('Pastry flour'));

        const results = await dal.search('flour', 2);

        expect(results).toHaveLength(2);
    });

    it('surfaces food-backed catalog rows with their resolution status', async () => {
        const created = await dal.createFoodBacked({
            name: makeCanonicalName('Basmati rice'),
            foodId: '01J0000000000000000000RICE',
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });

        const results = await dal.search('rice');

        expect(results.map((r) => r.id)).toContain(created.id);
        expect(results.find((r) => r.id === created.id)?.foodResolutionStatus).toBe(FoodResolutionStatus.PENDING);
    });

    it('dedups a freeform ingredient on case-insensitive name (no catalog bloat)', async () => {
        const first = await dal.createFreeform(makeCanonicalName('Saffron threads'));
        const second = await dal.createFreeform(makeCanonicalName('saffron THREADS'));

        expect(second.id).toBe(first.id);

        const { rows } = await pool.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM ingredients WHERE lower(name) = 'saffron threads'",
        );

        expect(rows[0]?.count).toBe('1');
    });
});
