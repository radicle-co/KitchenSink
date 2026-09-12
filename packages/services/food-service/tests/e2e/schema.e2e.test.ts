import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { MIGRATION_LEDGER_TABLE } from '@kitchensink/db-schema-guard';

import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { makePool } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

/**
 * Validates the source-agnostic `kitchensink_food` schema (T-100..T-104, T-111) against a REAL
 * Postgres. Applies the hand-authored ordered migration SQL — the source of truth the in-VPC runner
 * applies (FU-MIGRATE) — to a clean DB and probes the hardened constraints from plan.md §2 /
 * decision-register D-* (D-PROVENANCE-FK, D-LEASE, D-CANDIDATES, DB-5, DB-6, DB-7, DB-8):
 *
 *   - every food table and every controlled enum type exists;
 *   - `food.normalized_name` is UNIQUE (FR-005 dedup);
 *   - the composite same-item provenance FK rejects a `food_portions` or `food_field_provenance` row whose
 *     `source_id` belongs to a DIFFERENT item (the key DB-2 / D-PROVENANCE-FK integrity test);
 *   - `CHECK (amount >= 0)` / `CHECK (gram_weight > 0)` reject bad values (DB-6);
 *   - the operational text+CHECK columns (`food_sources.fetch_state`, `fetch_queue.status`) reject
 *     out-of-set values (DB-7);
 *   - the `nutrient (name, unit)` fallback dedup is UNIQUE (DB-5);
 *   - `fetch_queue` carries the `leased_at` lease column + the pending-priority and inflight-lease
 *     partial indexes (D-LEASE / DB-8);
 *   - the `pg_trgm` GIN indexes on `food.name` / `food.description` exist (FR-008);
 *   - `food_candidates` enforces `UNIQUE(food_id, source, external_key)` (D-CANDIDATES).
 *
 * Runs against a real Postgres named by `DATABASE_ADMIN_URL`, AS `food_app` (ADR-0039); skips cleanly when
 * none is set. ⚠️ The probes below read `information_schema` and `pg_catalog` through the SERVICE role —
 * which is the point: a catalogue view that hides its rows from a non-owner would make an assertion pass
 * vacuously, so each one asserts a non-empty result rather than a count of zero.
 */

/** Every food table (plan.md §2 "Final table list" + `food_candidates`, and the 0018 catalog tables). */
const EXPECTED_TABLES = [
    'food',
    'food_sources',
    'nutrient',
    'food_portions',
    'food_field_provenance',
    'food_category',
    'food_category_assignment',
    'food_candidates',
    'fetch_queue',
    'fetch_requesters',
    'source_call_log',
    'source_sync_metadata',
    // U18 (0014): authored-food version history — the recipe versioning pattern's table half.
    'food_versions',
    // U12 (0015): the promotion moderation queue — corroboration triggers, a human publishes.
    'food_promotions',
    // Curated catalog U4 (0018): the item-keyed catalog, the nutrition aggregate, forwards and the seed ledger.
    'food_item',
    'food_variant',
    'food_variant_part',
    'food_nutrition',
    'food_nutrition_citation',
    'food_nutrition_value',
    'food_forward',
    'catalog_seed_ledger',
    // U27 (0019): the block one source carries for every task (ADR-0053 §5).
    'source_backoff',
    // Plan 002 (0020): each requester's hourly share of the source window, read by every API task.
    'requester_source_budget',
    // ADR-0055 (0022): the search-gap record, wording cooks searched for a held food.
    'search_gap',
] as const;

/**
 * The controlled-set enums modelled with `pgEnum` (DB-7). `source_call_channel` arrives in 0010; 0018 drops
 * `food_origin` and adds the four catalog enums.
 */
const EXPECTED_ENUMS = [
    'food_status',
    'food_kind',
    'food_source',
    'food_field',
    'nutrient_basis',
    'source_call_channel',
    'food_item_owner_kind',
    'food_variant_attribute',
    'citation_dataset',
    'citation_match',
] as const;

/**
 * Seed the minimal two-food crosswalk used by the constraint probes. Each food has its own
 * `food_sources` row so the same-item provenance FK can be exercised both positively and negatively.
 *
 * @param pool - The connected pg pool.
 * @sideEffect Inserts rows into `food`, `food_sources`, and `nutrient`.
 */
async function seed(pool: pg.Pool): Promise<void> {
    await makeCatalogFood(pool, { id: 'food_a', name: null, normalizedName: 'apple', status: 'PENDING' });
    await makeCatalogFood(pool, { id: 'food_b', name: null, normalizedName: 'banana', status: 'PENDING' });
    await pool.query(
        `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('src_a', 'item-food_a', 'usda', 'A')`,
    );
    await pool.query(
        `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('src_b', 'item-food_b', 'usda', 'B')`,
    );
    await pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ('nut_protein', 'Protein', 'g')`);
    await pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ('nut_fat', 'Total fat', 'g')`);
    await pool.query(`INSERT INTO food_nutrition (id, food_id) VALUES ('nh_a', 'food_a')`);
    await pool.query(
        `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
         VALUES ('nc_a', 'nh_a', 'usdaSrFoundation', 'A', 'exact')`,
    );
}

describe('kitchensink_food schema (integration)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = makePool();
        // The schema itself is built once per run by `tests/globalSetup.ts`, with the service's OWN
        // production runner — this suite asserts what that runner produced, and does not replay the
        // `.sql` files itself (a second runner that would skip the lock, the privilege statements and the
        // ownership audit).
        await foodDb().truncate();
        await seed(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    describe('table + enum topology (D-CANDIDATES, and the 0018 catalog)', () => {
        it('creates every food table, and the migration ledger — and nothing else', async () => {
            const { rows } = await pool.query<{ table_name: string }>(
                `SELECT table_name FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
            );
            const names = new Set(rows.map((row) => row.table_name));

            for (const table of EXPECTED_TABLES) {
                expect(names, `missing table ${table}`).toContain(table);
            }

            // ⚠️ The migration ledger is one table more, present because the tier runs the real runner: replaying
            // the `.sql` files records nothing, and would leave a migrated stage database one table more than
            // the test ever sees. It is named from the
            // engine's own constant rather than spelled out, and kept OUT of `EXPECTED_TABLES` because it
            // belongs to the migration engine, not to the food schema.
            expect(names, `missing the migration ledger ${MIGRATION_LEDGER_TABLE}`).toContain(MIGRATION_LEDGER_TABLE);
            expect(names.size).toBe(EXPECTED_TABLES.length + 1);
        });

        it('creates the controlled-set enum types (DB-7)', async () => {
            const { rows } = await pool.query<{ typname: string }>(`SELECT typname FROM pg_type WHERE typtype = 'e'`);
            const names = new Set(rows.map((row) => row.typname));

            for (const enumType of EXPECTED_ENUMS) {
                expect(names, `missing enum ${enumType}`).toContain(enumType);
            }
        });

        it('has NO source-native identifier column (no fdc_id) on any table (SC-013)', async () => {
            const { rows } = await pool.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_schema = 'public' AND column_name = 'fdc_id'`,
            );
            expect(rows).toHaveLength(0);
        });
    });

    describe('source_call_log.channel (0010 migration — the reserved interactive lane, F-W1)', () => {
        it("adds a NOT NULL channel defaulting to 'worker' (the conservative backfill)", async () => {
            const { rows } = await pool.query<{ is_nullable: string; column_default: string; udt_name: string }>(
                `SELECT is_nullable, column_default, udt_name FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'source_call_log' AND column_name = 'channel'`,
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.is_nullable).toBe('NO');
            expect(rows[0]?.udt_name).toBe('source_call_channel');
            // Both defaults are wrong about SOME historical rows; 'worker' errs toward PROTECTING the
            // reserve (it makes the interactive lane look emptier and the drain's ceiling arrive sooner).
            expect(rows[0]?.column_default).toContain("'worker'");
        });

        it('keeps the pre-0010 two-column insert working, so a rolling deploy never makes an UNRECORDED call', async () => {
            // The previous image names only (source, called_at). Erroring here would be the one failure mode
            // that actually breaches the cap: a source call that happens but is never counted (ADR-0022).
            await expect(
                pool.query(`INSERT INTO source_call_log (source, called_at) VALUES ('usda', now())`),
            ).resolves.toBeDefined();

            const { rows } = await pool.query<{ channel: string }>(
                `SELECT channel FROM source_call_log ORDER BY id DESC LIMIT 1`,
            );
            expect(rows[0]?.channel).toBe('worker');
        });

        it("constrains channel to the ('interactive','worker') enum domain", async () => {
            await expect(
                pool.query(
                    `INSERT INTO source_call_log (source, channel, called_at) VALUES ('usda', 'background', now())`,
                ),
            ).rejects.toThrow();
        });

        it('keeps the admission access path on a (source, called_at) index prefix', async () => {
            // `channel` goes LAST precisely so the hot windowed count still has its two-column prefix. A
            // reordering that put `channel` first would leave every admission query without one.
            const { rows } = await pool.query<{ indexdef: string }>(
                `SELECT indexdef FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'idx_source_call_log_source_called_at'`,
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.indexdef).toMatch(/\(source, called_at, channel\)/u);
        });
    });

    describe('food.normalized_name UNIQUE (FR-005 dedup)', () => {
        it('rejects a second food with the same normalized_name', async () => {
            await expect(
                makeCatalogFood(pool, { id: 'food_dup', normalizedName: 'apple', status: 'PENDING' }),
            ).rejects.toThrow(/food_normalized_name_catalog_unique/);
        });
    });

    describe('composite same-item provenance FK (D-PROVENANCE-FK / DB-2, re-keyed by 0018)', () => {
        it('accepts a food_portions row whose source_id belongs to the SAME item', async () => {
            await expect(
                pool.query(
                    `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
                     VALUES ('fp_ok', 'item-food_a', '1 cup', '91', 'src_a')`,
                ),
            ).resolves.toMatchObject({ command: 'INSERT', rowCount: 1 });
        });

        it('REJECTS a food_portions row whose source_id belongs to a DIFFERENT item', async () => {
            // source_id 'src_b' is food_b's item's crosswalk row; the portion claims food_a's item → the composite
            // (item_id, source_id) FK to food_sources(item_id, id) has no match.
            await expect(
                pool.query(
                    `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
                     VALUES ('fp_cross', 'item-food_a', '1 cup', '91', 'src_b')`,
                ),
            ).rejects.toThrow(/food_portions_same_item_fk/);
        });

        it('REJECTS a food_field_provenance row whose source_id belongs to a DIFFERENT item', async () => {
            await expect(
                pool.query(
                    `INSERT INTO food_field_provenance (item_id, field, source_id)
                     VALUES ('item-food_a', 'name', 'src_b')`,
                ),
            ).rejects.toThrow(/food_field_provenance_same_item_fk/);
        });
    });

    describe('numeric value CHECK constraints (DB-6)', () => {
        it('rejects a negative food_nutrition_value.amount', async () => {
            await expect(
                pool.query(
                    `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, citation_id)
                     VALUES ('nh_a', 'nut_fat', '-1', 'nc_a')`,
                ),
            ).rejects.toThrow(/food_nutrition_value_amount_nonneg/);
        });

        it('rejects a non-positive food_portions.gram_weight', async () => {
            await expect(
                pool.query(
                    `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
                     VALUES ('fp_zero', 'item-food_a', '1 cup', '0', 'src_a')`,
                ),
            ).rejects.toThrow(/food_portions_gram_weight_pos/);
        });
    });

    describe('operational text+CHECK columns (DB-7)', () => {
        it('rejects an invalid food_sources.fetch_state', async () => {
            await expect(
                pool.query(
                    `INSERT INTO food_sources (id, item_id, source, external_key, fetch_state)
                     VALUES ('src_bad', 'item-food_a', 'usda', 'C', 'bogus')`,
                ),
            ).rejects.toThrow();
        });

        it('rejects an invalid fetch_queue.status', async () => {
            await expect(
                pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ('food_a', 'bogus')`),
            ).rejects.toThrow();
        });
    });

    describe('nutrient (name, unit) fallback dedup UNIQUE (DB-5)', () => {
        it('rejects a second nutrient with the same (name, unit)', async () => {
            await expect(
                pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ('nut_dup', 'Protein', 'g')`),
            ).rejects.toThrow();
        });
    });

    describe('fetch_queue lease column + partial indexes (D-LEASE / DB-8)', () => {
        it('has a nullable leased_at column', async () => {
            const { rows } = await pool.query<{ is_nullable: string }>(
                `SELECT is_nullable FROM information_schema.columns
                  WHERE table_name = 'fetch_queue' AND column_name = 'leased_at'`,
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.is_nullable).toBe('YES');
        });

        it('creates the pending-priority and inflight-lease partial indexes', async () => {
            const { rows } = await pool.query<{ indexname: string }>(
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
            );
            const names = new Set(rows.map((row) => row.indexname));
            expect(names).toContain('idx_fetch_queue_priority');
            expect(names).toContain('idx_fetch_queue_inflight_lease');
        });
    });

    describe('pg_trgm fuzzy-search indexes (FR-008)', () => {
        it('installs the pg_trgm extension', async () => {
            const { rows } = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
            expect(rows).toHaveLength(1);
        });

        it('creates GIN trigram indexes on food.name and food.description', async () => {
            const { rows } = await pool.query<{ indexname: string }>(
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
            );
            const names = new Set(rows.map((row) => row.indexname));
            expect(names).toContain('food_name_trgm_idx');
            expect(names).toContain('food_description_trgm_idx');
        });
    });

    describe('ranked full-text search column + GIN index (T-180 / FR-008 optional ranked FTS)', () => {
        it('adds a STORED generated tsvector column food.search_vector (0001 migration)', async () => {
            const { rows } = await pool.query<{ data_type: string; is_generated: string }>(
                `SELECT data_type, is_generated FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'food' AND column_name = 'search_vector'`,
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.data_type).toBe('tsvector');
            expect(rows[0]?.is_generated).toBe('ALWAYS');
        });

        it('creates the GIN index over food.search_vector for ranked FTS', async () => {
            const { rows } = await pool.query<{ indexname: string }>(
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
            );
            expect(new Set(rows.map((row) => row.indexname))).toContain('food_search_vector_idx');
        });

        it('keeps the pg_trgm fuzzy indexes alongside the FTS index (fuzzy fallback retained)', async () => {
            const { rows } = await pool.query<{ indexname: string }>(
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
            );
            const names = new Set(rows.map((row) => row.indexname));
            expect(names).toContain('food_name_trgm_idx');
            expect(names).toContain('food_search_vector_idx');
        });
    });

    describe('food_candidates UNIQUE(food_id, source, external_key) (D-CANDIDATES)', () => {
        it('rejects a duplicate (food_id, source, external_key) candidate', async () => {
            await pool.query(
                `INSERT INTO food_candidates (id, food_id, source, external_key, name)
                 VALUES ('cand_1', 'food_a', 'usda', '171688', 'Broccoli, raw')`,
            );
            await expect(
                pool.query(
                    `INSERT INTO food_candidates (id, food_id, source, external_key, name)
                     VALUES ('cand_2', 'food_a', 'usda', '171688', 'Broccoli, raw (dup)')`,
                ),
            ).rejects.toThrow();
        });
    });
});
