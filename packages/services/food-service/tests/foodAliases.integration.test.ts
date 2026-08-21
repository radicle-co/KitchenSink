/**
 * Integration tests for USDA's recovered alias table against a REAL Postgres (plan U2 / KTD-2).
 *
 * Three things here are unprovable by any unit test, which is why this tier is not optional:
 *
 *  1. **The migration applied.** `0007_food_aliases.sql` adds a column, a STORED GENERATED tsvector and a
 *     GIN index. A mocked DAO test observes none of that; the column can be missing and every unit test
 *     stays green.
 *  2. **The generated expression is IMMUTABLE.** Postgres rejects a generated column whose expression is
 *     merely STABLE — which is exactly why the column is `text` and not `text[]` (`array_to_string` is
 *     `provolatile = 's'`). Only a real `CREATE TABLE` can tell us we got that right.
 *  3. **An alias-only query resolves.** `Tillamook` appears in no name and no description; if the second
 *     vector is not in the DAO's predicate, the row is unreachable — and if it is in the predicate but not
 *     in the score, the row ranks 0 and falls off the 20-row page, which "does it match" cannot see.
 *
 * The write path is exercised end-to-end through `MergeAndPersistService`, not by inserting the column
 * directly: the defect U2 fixes is that the value was DROPPED between the USDA client and the row, and a
 * hand-written INSERT would step over the whole path that dropped it.
 *
 * Reuses `tests/support/db.ts` (applies every ordered migration to a clean `public`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSearchDao } from '../src/foods/dao/foodSearch.dao.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../src/foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import type { CanonicalCandidate } from '../src/sources/foodSourceAdapter.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** A canonical candidate as the USDA adapter would emit it, overridable per case. */
function makeCandidate(overrides: Partial<CanonicalCandidate> = {}): CanonicalCandidate {
    return {
        source: 'usda',
        externalKey: '2705709',
        name: 'Cheese, Cheddar',
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        description: 'Cheese, Cheddar',
        barcode: null,
        aliases: [],
        nutrients: [],
        portions: [],
        itemVersion: 'v1',
        ...overrides,
    };
}

describe.skipIf(!DATABASE_URL)('food.aliases — USDA curated aliases (U2, integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let persist: MergeAndPersistService;
    let search: FoodSearchDao;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
        db = makeDb(pool);
        persist = new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry()));
        search = new FoodSearchDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food CASCADE');
    });

    /**
     * Create the `PENDING` shell the merge path resolves, exactly as `FoodDao.createByName` does.
     *
     * @param name - The requested food name.
     * @returns The internal food id.
     */
    async function createPending(name: string): Promise<string> {
        const { id } = await new FoodDao(db).createByName({ normalizedName: name.toLowerCase(), displayName: name });

        return id;
    }

    describe('the migrated schema (0007)', () => {
        it('adds a nullable text column food.aliases', async () => {
            const { rows } = await pool.query<{ data_type: string; is_nullable: string; is_generated: string }>(
                `SELECT data_type, is_nullable, is_generated FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'food' AND column_name = 'aliases'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]?.data_type).toBe('text');
            // Nullable on purpose: "no aliases" is ABSENCE, and GR-019 forbids an `''` sentinel for it.
            expect(rows[0]?.is_nullable).toBe('YES');
            expect(rows[0]?.is_generated).toBe('NEVER');
        });

        it('adds a STORED generated tsvector food.aliases_search_vector', async () => {
            const { rows } = await pool.query<{ data_type: string; is_generated: string }>(
                `SELECT data_type, is_generated FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'food'
                    AND column_name = 'aliases_search_vector'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]?.data_type).toBe('tsvector');
            expect(rows[0]?.is_generated).toBe('ALWAYS');
        });

        it('keeps the alias vector SEPARATE from search_vector (PG 17 SET EXPRESSION is unavailable)', async () => {
            // Folding aliases into `search_vector` on PG 16 means DROP + ADD COLUMN: an ACCESS EXCLUSIVE
            // lock, a rewrite of `food`, and `food_search_vector_idx` dropped with it. This assertion is
            // what stops that being done by accident before U13 moves the engine.
            const { rows } = await pool.query<{ expression: string }>(
                `SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
                   FROM pg_attrdef d
                   JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                  WHERE d.adrelid = 'food'::regclass AND a.attname = 'search_vector'`,
            );

            expect(rows[0]?.expression).not.toContain('aliases');
        });

        it('indexes the alias vector with GIN', async () => {
            const { rows } = await pool.query<{ indexdef: string }>(
                `SELECT indexdef FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'food_aliases_search_vector_idx'`,
            );

            expect(String(rows[0]?.indexdef)).toMatch(/USING gin \(aliases_search_vector\)/);
        });

        it("admits 'aliases' to the food_field provenance enum, so the new scalar can carry provenance", async () => {
            const { rows } = await pool.query<{ value: string }>(
                `SELECT unnest(enum_range(NULL::food_field))::text AS value`,
            );

            expect(rows.map((row) => row.value)).toContain('aliases');
        });
    });

    describe('the write path (client shape → merge → row)', () => {
        it('persists the aliases the adapter carried, flattened onto the stored delimiter', async () => {
            const id = await createPending('Cheese, Cheddar');

            await persist.resolveAndPersist({
                foodId: id,
                candidates: [makeCandidate({ aliases: ['sharp cheese', 'Tillamook', 'Longhorn'] })],
            });

            const { rows } = await pool.query<{ aliases: string | null }>('SELECT aliases FROM food WHERE id = $1', [
                id,
            ]);

            expect(rows[0]?.aliases).toBe('sharp cheese; Tillamook; Longhorn');
        });

        it('persists NULL — not an empty string — for a food with no aliases (GR-019)', async () => {
            const id = await createPending('Cheese, cheddar (Foundation)');

            await persist.resolveAndPersist({ foodId: id, candidates: [makeCandidate({ aliases: [] })] });

            const { rows } = await pool.query<{ aliases: string | null }>('SELECT aliases FROM food WHERE id = $1', [
                id,
            ]);

            expect(rows[0]?.aliases).toBeNull();
        });

        it('records provenance for the aliases against the contributing crosswalk row', async () => {
            const id = await createPending('Cheese, Cheddar (provenance)');

            await persist.resolveAndPersist({
                foodId: id,
                candidates: [makeCandidate({ aliases: ['Tillamook'] })],
            });

            const { rows } = await pool.query<{ external_key: string }>(
                `SELECT s.external_key
                   FROM food_field_provenance p
                   JOIN food_sources s ON s.id = p.source_id
                  WHERE p.food_id = $1 AND p.field = 'aliases'`,
                [id],
            );

            expect(rows[0]?.external_key).toBe('2705709');
        });

        it('computes the alias vector from the stored text — it is generated, never written', async () => {
            const id = await createPending('Cheese, Cheddar (vector)');

            await persist.resolveAndPersist({
                foodId: id,
                candidates: [makeCandidate({ aliases: ['Tillamook'] })],
            });

            const { rows } = await pool.query<{ matched: boolean }>(
                `SELECT aliases_search_vector @@ plainto_tsquery('english', 'tillamook') AS matched
                   FROM food WHERE id = $1`,
                [id],
            );

            expect(rows[0]?.matched).toBe(true);
        });
    });

    describe('the read path (alias-only search)', () => {
        it('resolves a query that matches ONLY an alias', async () => {
            const cheddar = await createPending('Cheese, Cheddar');
            const swiss = await createPending('Cheese, Swiss');

            await persist.resolveAndPersist({
                foodId: cheddar,
                candidates: [makeCandidate({ aliases: ['sharp cheese', 'Tillamook', 'Longhorn'] })],
            });
            await persist.resolveAndPersist({
                foodId: swiss,
                candidates: [
                    makeCandidate({ externalKey: '2705800', name: 'Cheese, Swiss', description: 'Cheese, Swiss' }),
                ],
            });

            // 'Tillamook' is in no name and no description in the store — only the alias vector can find it.
            const hits = await search.search('Tillamook');

            expect(hits.map((hit) => hit.id)).toEqual([cheddar]);
        });

        it('SCORES the alias hit above zero, so it survives the 20-row page', async () => {
            const id = await createPending('Cheese, Cheddar');

            await persist.resolveAndPersist({
                foodId: id,
                candidates: [makeCandidate({ aliases: ['Tillamook'] })],
            });

            const [hit] = await search.search('Tillamook');

            expect(hit?.score).toBeGreaterThan(0);
        });

        it('ranks an exact-name match ABOVE an alias-only match — the alias branch is additive', async () => {
            // The alias vector must not out-rank the name it is a synonym FOR. `Cheddar cheese` scores
            // similarity 1.0 against its own name; an alias hit scores a `ts_rank`, which is far smaller.
            // If GREATEST ever gained a weight that inverted that, this reds.
            const named = await createPending('Cheddar cheese');
            const aliased = await createPending('Processed cheese product');

            await persist.resolveAndPersist({
                foodId: named,
                candidates: [makeCandidate({ externalKey: '1', name: 'Cheddar cheese', description: null })],
            });
            await persist.resolveAndPersist({
                foodId: aliased,
                candidates: [
                    makeCandidate({
                        externalKey: '2',
                        name: 'Processed cheese product',
                        description: null,
                        aliases: ['cheddar cheese blend'],
                    }),
                ],
            });

            const hits = await search.search('Cheddar cheese');

            expect(hits.map((hit) => hit.id)).toEqual([named, aliased]);
        });

        it('does not match an alias by mid-word substring — the branch is lexemes, not ILIKE', async () => {
            // If someone "helpfully" adds `aliases ILIKE '%q%'`, this reds. That branch is the per-row cost
            // 0004 spent a whole migration removing from `name %`; it must not come back on a second column.
            const id = await createPending('Cheese, Cheddar');

            await persist.resolveAndPersist({
                foodId: id,
                candidates: [makeCandidate({ aliases: ['Tillamook'] })],
            });

            const hits = await search.search('llamoo');

            expect(hits.map((hit) => hit.id)).not.toContain(id);
        });
    });
});
