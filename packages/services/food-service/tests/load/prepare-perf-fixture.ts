/**
 * Seed the local food store the SC-001 / SC-004 / SC-005 / SC-007 k6 scripts measure against, and emit the
 * `perf-fixture.json` they `open()`.
 *
 * The food mirror of identity's `tests/load/prepare-db.ts`, with two deliberate differences:
 *
 *  1. **It does NOT drop the schema.** Identity's step DROPs `public` and re-applies its migrations, which
 *     is safe only because the identity service is booted AFTER it. Here the service under test is already
 *     running (the erasure scenario ran first, inside its 120s token TTL), and a dropped schema would leave
 *     that container's 20-connection pool holding sessions against tables that no longer exist. So this
 *     script is purely ADDITIVE and idempotent (`ON CONFLICT DO NOTHING`), and it FAILS LOUDLY if the
 *     schema is absent instead of creating it — applying `src/db/migrations/*.sql` is the caller's job
 *     (the CI job does it; locally `npm run test:integration` or a `psql` loop does).
 *  2. **Every population is set-based.** 50,000 foods, ~100,000 nutrient values, ~15,000 portions and
 *     ~10,000 provenance rows are inserted by `INSERT … SELECT … FROM generate_series(…)`, i.e. FOUR
 *     statements rather than 175,000 round trips. Row content is rendered by SQL fragments exported from
 *     `perf-fixture.ts` alongside the TypeScript builders, and the two renderings are asserted to agree
 *     (see `assertRenderingsAgree`) rather than trusted by eye.
 *
 * ## What gets seeded, and why each population exists
 *
 *  - **`RESOLVED` foods** (`FOOD_PERF_RESOLVED_FOODS`, default 50,000) — SC-007's stated population size
 *    ("a local store of up to 50,000 foods"). All of them carry a name, a description and a crosswalk row,
 *    so all three GIN indexes (`food_search_vector_idx`, `food_name_trgm_idx`,
 *    `food_description_trgm_idx`) hold 50,000 entries. This is what gives the search measurement its cost.
 *  - **Read targets** (`FOOD_PERF_READ_TARGETS`, default 5,000) — the leading slice of the `RESOLVED`
 *    population, given a FULL golden record (20 nutrients + 3 portions + scalar provenance + a barcode).
 *    5,000 is SC-004's stated warm-store threshold ("once the local store contains 5,000+ unique RESOLVED
 *    foods"), and these are the ids `local-store-read.load.js` reads.
 *  - **`PENDING` foods** and **tombstoned `NOT_FOUND` foods** (default 500 each) — the NOT-served side of
 *    the SC-004 ratio. A read of one answers `202` / `404`: the caller got no food data, so the request was
 *    not served from the local store. Without them the serve rate would be 100% by construction and the
 *    SC-004 threshold could not fail for any reason.
 *
 * Usage (from packages/services/food-service):
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_load npm run test:load:fixture
 *   FOOD_PERF_RESOLVED_FOODS=5000 DATABASE_URL=… npm run test:load:fixture   # a fast smoke shape
 *
 * @sideEffect Writes ~175,000 rows to `DATABASE_URL` (additively) and writes `perf-fixture.json` next to
 *            this script. Refuses any database not named in `perf-fixture.ts`'s disposable allowlist.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
    BRANDS,
    CUTS,
    INGREDIENTS,
    PERF_FIXTURE_FILENAME,
    PERF_NUTRIENTS,
    PERF_PORTION_LABELS,
    PREPARATIONS,
    assertValidPerfId,
    buildSearchProbes,
    perfBarcode,
    perfBarcodeSql,
    perfExternalKey,
    perfFoodDescription,
    perfFoodDescriptionSql,
    perfFoodId,
    perfFoodIdSql,
    perfFoodName,
    perfFoodNameSql,
    perfNormalizedName,
    perfRowIdSql,
    perfSourceIdSql,
    requireDisposableDatabaseUrl,
    type PerfFixtureFile,
    type PerfFoodKind,
} from './perf-fixture.js';

const outDir = dirname(fileURLToPath(import.meta.url));
const connectionString = requireDisposableDatabaseUrl();

/** SC-007's population size. */
const RESOLVED_FOODS = Math.max(1, Number(process.env['FOOD_PERF_RESOLVED_FOODS'] ?? 50_000));
/** SC-004's warm-store threshold, and the read population for SC-001/SC-005. */
const READ_TARGETS = Math.min(RESOLVED_FOODS, Math.max(1, Number(process.env['FOOD_PERF_READ_TARGETS'] ?? 5_000)));
/** The not-served side of the SC-004 ratio. */
const PENDING_FOODS = Math.max(1, Number(process.env['FOOD_PERF_PENDING_FOODS'] ?? 500));
const NOT_FOUND_FOODS = Math.max(1, Number(process.env['FOOD_PERF_NOT_FOUND_FOODS'] ?? 500));
/** How many distinct probes of each search shape to emit (the scripts rotate through them). */
const SEARCH_PROBES = Math.max(1, Number(process.env['FOOD_PERF_SEARCH_PROBES'] ?? 32));

const pool = new pg.Pool({ connectionString });

/** The vocabulary arrays passed to every rendering statement, in placeholder order after `$1` (the count). */
const VOCAB_PARAMS = { preparations: 2, ingredients: 3, cuts: 4, brands: 5 } as const;
const vocabValues = [[...PREPARATIONS], [...INGREDIENTS], [...CUTS], [...BRANDS]];

/**
 * Fail with an actionable message and a non-zero exit. Never `console.warn`-and-continue: a fixture that
 * half-seeded is a run that measures the wrong store while reporting green.
 *
 * @param message - What went wrong and what the operator should do about it.
 * @sideEffect Terminates the process.
 */
function fail(message: string): never {
    console.error(`prepare-perf-fixture: ${message}`);
    process.exit(1);
}

/**
 * Require the food schema to already exist.
 *
 * @sideEffect Reads `information_schema`; terminates the process when the schema is absent.
 */
async function requireSchema(): Promise<void> {
    const { rows } = await pool.query<{ present: boolean }>(
        `SELECT count(*) = 4 AS present
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('food', 'food_sources', 'food_nutrients', 'fetch_queue')`,
    );

    if (rows[0]?.present !== true) {
        fail(
            'the food schema is not present in this database. This script is deliberately ADDITIVE and ' +
                'never creates it (the service under test is already connected). Apply the ordered DDL first:\n' +
                '  for f in src/db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done',
        );
    }
}

/**
 * Insert one `food` population.
 *
 * `search_vector` is a STORED GENERATED column and is deliberately absent from the column list — Postgres
 * computes it, which is exactly the write-side cost the deployed service pays.
 *
 * @param kind - Which population to insert.
 * @param count - How many rows.
 * @param status - The `food.status` every row carries.
 * @param options - `barcodeBelow`: give a barcode to rows whose index is below this (0 = none);
 *   `tombstoned`: stamp `tombstoned_at` (the NOT_FOUND TTL clock, FR-025).
 * @returns The number of rows actually inserted.
 * @sideEffect Writes to `food`.
 */
async function insertFoods(
    kind: PerfFoodKind,
    count: number,
    status: 'RESOLVED' | 'PENDING' | 'NOT_FOUND',
    options: { readonly barcodeBelow: number; readonly tombstoned: boolean },
): Promise<number> {
    const name = perfFoodNameSql(kind, 's.i', VOCAB_PARAMS);
    const description = perfFoodDescriptionSql('s.i', VOCAB_PARAMS);
    const result = await pool.query(
        `INSERT INTO food (
             id, name, normalized_name, description, kind, brand_owner, brand_name, barcode,
             status, origin, tombstoned_at, created_at, updated_at
         )
         SELECT ${perfFoodIdSql(kind, 's.i')},
                ${name},
                lower(${name}),
                ${description},
                CASE WHEN s.i % 3 = 0 THEN 'branded' ELSE 'generic' END::food_kind,
                CASE WHEN s.i % 3 = 0 THEN ($5::text[])[(s.i % ${BRANDS.length}) + 1] || ' foods, inc.' END,
                CASE WHEN s.i % 3 = 0 THEN ($5::text[])[(s.i % ${BRANDS.length}) + 1] END,
                CASE WHEN s.i < $6::int THEN ${perfBarcodeSql('s.i')} END,
                $7::food_status,
                -- 'bulk': a synthetic fixture food has no live upstream item, and the change-refresh scan
                -- (FoodSourcesDao.listResolvedBackingItems) excludes bulk-origin rows — so if a worker is
                -- ever pointed at a seeded database it cannot try to re-pull 50,000 non-existent items.
                'bulk',
                CASE WHEN $8::boolean THEN now() END,
                now(), now()
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [count, ...vocabValues, options.barcodeBelow, status, options.tombstoned],
    );

    return result.rowCount ?? 0;
}

/**
 * Insert one crosswalk row per food of a population, so every seeded food has the `food_sources` row a
 * real golden record has (and the composite per-value provenance FK has a target to reference).
 *
 * @param kind - Which population.
 * @param count - How many rows.
 * @returns The number of rows inserted.
 * @sideEffect Writes to `food_sources`.
 */
async function insertSources(kind: PerfFoodKind, count: number): Promise<number> {
    const externalKeyBase = Number(perfExternalKey(kind, 0));
    const result = await pool.query(
        `INSERT INTO food_sources (id, food_id, source, external_key, fetch_state, item_version, fetched_at)
         SELECT ${perfSourceIdSql(kind, 's.i')},
                ${perfFoodIdSql(kind, 's.i')},
                'usda',
                ($2::bigint + s.i)::text,
                'fetched',
                '2026-01-01',
                now()
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [count, externalKeyBase],
    );

    return result.rowCount ?? 0;
}

/**
 * Seed the nutrient dictionary (one row per {@link PERF_NUTRIENTS} entry).
 *
 * @returns The number of rows inserted.
 * @sideEffect Writes to `nutrient`.
 */
async function insertNutrientDictionary(): Promise<number> {
    const result = await pool.query(
        `INSERT INTO nutrient (id, name, unit, external_code)
         SELECT ${perfRowIdSql('nutrient', 'D', 's.i')}, ($1::text[])[s.i + 1], ($2::text[])[s.i + 1], ($3::text[])[s.i + 1]
           FROM generate_series(0, ${PERF_NUTRIENTS.length - 1}) AS s(i)
         ON CONFLICT DO NOTHING`,
        [
            PERF_NUTRIENTS.map((entry) => entry.name),
            PERF_NUTRIENTS.map((entry) => entry.unit),
            PERF_NUTRIENTS.map((entry) => entry.code),
        ],
    );

    return result.rowCount ?? 0;
}

/**
 * Give the read-target population its golden values: {@link PERF_NUTRIENTS}.length nutrient values and
 * {@link PERF_PORTION_LABELS}.length portions per food, plus scalar provenance for `name`/`description`.
 *
 * Each value's `source_id` is that food's OWN crosswalk row, which is what the composite
 * `(food_id, source_id) → food_sources(food_id, id)` FK requires (D-PROVENANCE-FK) — a shared source row
 * would be rejected, so this is also a live check that the fixture respects the real constraint.
 *
 * @param count - How many read targets to enrich.
 * @returns Row counts per table.
 * @sideEffect Writes to `food_nutrients`, `food_portions` and `food_field_provenance`.
 */
async function enrichReadTargets(count: number): Promise<{
    nutrients: number;
    portions: number;
    provenance: number;
}> {
    const nutrientCount = PERF_NUTRIENTS.length;
    const nutrients = await pool.query(
        `INSERT INTO food_nutrients (id, food_id, nutrient_id, amount, basis, source_id)
         SELECT ${perfRowIdSql('nutrientValue', 'V', `s.i * ${nutrientCount} + t.k`)},
                ${perfFoodIdSql('resolved', 's.i')},
                ${perfRowIdSql('nutrient', 'D', 't.k')},
                -- Deterministic, non-negative (the food_nutrients_amount_nonneg CHECK), and varied enough
                -- that the numeric column stores real precision rather than 20 copies of one value.
                round((((s.i * 7 + t.k * 13) % 9973) / 100.0)::numeric, 3),
                'per_100g',
                ${perfSourceIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN generate_series(0, ${nutrientCount - 1}) AS t(k)
         ON CONFLICT DO NOTHING`,
        [count],
    );

    const portions = await pool.query(
        `INSERT INTO food_portions (id, food_id, label, gram_weight, source_id)
         SELECT ${perfRowIdSql('portion', 'W', `s.i * ${PERF_PORTION_LABELS.length} + t.k`)},
                ${perfFoodIdSql('resolved', 's.i')},
                ($2::text[])[t.k + 1],
                -- Strictly positive (food_portions_gram_weight_pos).
                (10 + ((s.i + t.k) % 240))::numeric,
                ${perfSourceIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN generate_series(0, ${PERF_PORTION_LABELS.length - 1}) AS t(k)
         ON CONFLICT DO NOTHING`,
        [count, [...PERF_PORTION_LABELS]],
    );

    const provenance = await pool.query(
        `INSERT INTO food_field_provenance (food_id, field, source_id)
         SELECT ${perfFoodIdSql('resolved', 's.i')}, t.field::food_field, ${perfSourceIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN (VALUES ('name'), ('description'), ('kind')) AS t(field)
         ON CONFLICT (food_id, field) DO NOTHING`,
        [count],
    );

    return {
        nutrients: nutrients.rowCount ?? 0,
        portions: portions.rowCount ?? 0,
        provenance: provenance.rowCount ?? 0,
    };
}

/**
 * Prove the SQL rendering matches the TypeScript builders for the first row of a population.
 *
 * This is the seeder's most important assertion. Every fixture rule is written twice — once as a pure
 * function the k6 scripts' data derives from, once as a SQL fragment 50,000 rows are built by — and a
 * silent divergence would be INVISIBLE downstream: `perf-fixture.json` would list ids for rows that do not
 * exist, every read would answer `404`, the SC-004 serve rate would collapse and the failure would look
 * like a service defect. So the two renderings are compared against the database, not reviewed by eye.
 *
 * @param kind - Which population to probe.
 * @param expectBarcode - Whether row 0 of this population should carry a barcode (the crosswalk target).
 * @sideEffect Reads `food`/`food_sources`; terminates the process on a mismatch.
 */
async function assertRenderingsAgree(kind: PerfFoodKind, expectBarcode: boolean): Promise<void> {
    const id = perfFoodId(kind, 0);
    assertValidPerfId(id);

    const { rows } = await pool.query<{
        name: string | null;
        normalized_name: string;
        description: string | null;
        barcode: string | null;
        external_key: string | null;
    }>(
        `SELECT f.name, f.normalized_name, f.description, f.barcode, s.external_key
           FROM food f LEFT JOIN food_sources s ON s.food_id = f.id
          WHERE f.id = $1`,
        [id],
    );

    const actual = rows[0];
    const expected = {
        name: perfFoodName(kind, 0),
        normalized_name: perfNormalizedName(kind, 0),
        description: perfFoodDescription(0),
        barcode: expectBarcode ? perfBarcode(0) : null,
        external_key: perfExternalKey(kind, 0),
    };

    if (
        actual === undefined ||
        actual.name !== expected.name ||
        actual.normalized_name !== expected.normalized_name ||
        actual.description !== expected.description ||
        actual.barcode !== expected.barcode ||
        actual.external_key !== expected.external_key
    ) {
        fail(
            `the SQL rendering of the '${kind}' population does not match perf-fixture.ts. Expected ` +
                `${JSON.stringify(expected)}, database has ${JSON.stringify(actual ?? null)}. The emitted ` +
                `fixture ids would name rows that do not exist.`,
        );
    }
}

/**
 * Prove a read target really is readable as a golden record — the exact shape `GET /api/v1/foods/{id}`
 * serves. A read target with zero nutrients would make SC-001 measure an empty aggregate.
 *
 * @sideEffect Reads the value tables; terminates the process when the golden record is incomplete.
 */
async function assertGoldenRecordDepth(): Promise<void> {
    const id = perfFoodId('resolved', 0);
    const { rows } = await pool.query<{ nutrients: number; portions: number; provenance: number; sources: number }>(
        `SELECT (SELECT count(*)::int FROM food_nutrients WHERE food_id = $1)        AS nutrients,
                (SELECT count(*)::int FROM food_portions WHERE food_id = $1)         AS portions,
                (SELECT count(*)::int FROM food_field_provenance WHERE food_id = $1) AS provenance,
                (SELECT count(*)::int FROM food_sources WHERE food_id = $1)          AS sources`,
        [id],
    );
    const actual = rows[0];

    if (
        actual === undefined ||
        actual.nutrients !== PERF_NUTRIENTS.length ||
        actual.portions !== PERF_PORTION_LABELS.length ||
        actual.provenance !== 3 ||
        actual.sources !== 1
    ) {
        fail(
            `read target ${id} does not carry a full golden record (expected ${PERF_NUTRIENTS.length} ` +
                `nutrients / ${PERF_PORTION_LABELS.length} portions / 3 provenance / 1 source, got ` +
                `${JSON.stringify(actual ?? null)}). SC-001 would measure an empty aggregate read.`,
        );
    }
}

/**
 * Prove the SC-007 probe set actually exercises the search predicate: the broad probe must match FAR more
 * rows than the endpoint's 20-row limit (so the planner cannot satisfy the limit early and skip the ranking
 * work), and the miss probe must match none.
 *
 * This is the food analogue of identity's needle-selectivity reasoning: a probe whose match set is smaller
 * than the limit reports a short-circuit as though it were the full query.
 *
 * @param probes - The emitted probe set.
 * @sideEffect Reads `food`; terminates the process when a probe is mis-calibrated.
 */
async function assertProbeSelectivity(probes: { broad: readonly string[]; miss: readonly string[] }): Promise<void> {
    const broad = probes.broad[0]!;
    const miss = probes.miss[0]!;
    const { rows } = await pool.query<{ broad_matches: number; miss_matches: number }>(
        `SELECT (SELECT count(*)::int FROM food
                  WHERE status = 'RESOLVED' AND search_vector @@ plainto_tsquery('english', $1)) AS broad_matches,
                (SELECT count(*)::int FROM food
                  WHERE status = 'RESOLVED' AND (search_vector @@ plainto_tsquery('english', $2)
                        OR name % $2::text
                        OR name ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%')) AS miss_matches`,
        [broad, miss],
    );
    const actual = rows[0];

    if (actual === undefined || actual.broad_matches <= 20) {
        fail(
            `the broad search probe '${broad}' matches ${actual?.broad_matches ?? 'unknown'} RESOLVED rows, ` +
                `which does not exceed the endpoint's 20-row limit — the measurement would report a ` +
                `short-circuited scan as a full ranked search. Seed more foods (FOOD_PERF_RESOLVED_FOODS).`,
        );
    }

    if (actual.miss_matches !== 0) {
        fail(
            `the miss probe '${miss}' matches ${actual.miss_matches} row(s); it must match ZERO so the ` +
                `predicate is evaluated in full. The vocabulary in perf-fixture.ts must have changed.`,
        );
    }
}

try {
    await requireSchema();

    const resolved = await insertFoods('resolved', RESOLVED_FOODS, 'RESOLVED', {
        barcodeBelow: READ_TARGETS,
        tombstoned: false,
    });
    const pending = await insertFoods('pending', PENDING_FOODS, 'PENDING', { barcodeBelow: 0, tombstoned: false });
    const notFound = await insertFoods('notFound', NOT_FOUND_FOODS, 'NOT_FOUND', {
        barcodeBelow: 0,
        tombstoned: true,
    });

    const resolvedSources = await insertSources('resolved', RESOLVED_FOODS);
    await insertSources('pending', PENDING_FOODS);
    await insertSources('notFound', NOT_FOUND_FOODS);

    await insertNutrientDictionary();
    const enriched = await enrichReadTargets(READ_TARGETS);

    // The planner's choice for every search predicate depends on table statistics, and a freshly
    // bulk-loaded table has none — leaving SC-007 measuring a plan the deployed service would never
    // choose. ANALYZE makes the measured plan the honest one. (Identity's prepare-db does the same for
    // the admin scan, for the same reason.)
    await pool.query('ANALYZE food, food_sources, food_nutrients, food_portions, food_field_provenance, nutrient');

    await assertRenderingsAgree('resolved', true);
    await assertRenderingsAgree('pending', false);
    await assertRenderingsAgree('notFound', false);
    await assertGoldenRecordDepth();

    const search = buildSearchProbes(SEARCH_PROBES);
    await assertProbeSelectivity(search);

    const fixture: PerfFixtureFile = {
        generatedAt: new Date().toISOString(),
        resolvedFoods: RESOLVED_FOODS,
        readTargets: READ_TARGETS,
        resolvedIds: Array.from({ length: READ_TARGETS }, (_unused, index) => perfFoodId('resolved', index)),
        pendingIds: Array.from({ length: PENDING_FOODS }, (_unused, index) => perfFoodId('pending', index)),
        notFoundIds: Array.from({ length: NOT_FOUND_FOODS }, (_unused, index) => perfFoodId('notFound', index)),
        search,
    };

    writeFileSync(join(outDir, PERF_FIXTURE_FILENAME), JSON.stringify(fixture), 'utf-8');

    const totals = await pool.query<{ foods: number; resolved: number }>(
        `SELECT count(*)::int AS foods,
                count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved
           FROM food`,
    );

    console.log(
        `prepare-perf-fixture: inserted ${resolved} RESOLVED + ${pending} PENDING + ${notFound} NOT_FOUND ` +
            `foods, ${resolvedSources} crosswalk rows, ${enriched.nutrients} nutrient values, ` +
            `${enriched.portions} portions, ${enriched.provenance} provenance rows; ` +
            `food total = ${totals.rows[0]?.foods} (${totals.rows[0]?.resolved} RESOLVED); ` +
            `barcode on the first ${READ_TARGETS}; wrote ${PERF_FIXTURE_FILENAME} ` +
            `(${fixture.resolvedIds.length} read targets, ${SEARCH_PROBES} probes per search shape).`,
    );

    if (resolved === 0 && pending === 0 && notFound === 0) {
        console.log(
            'prepare-perf-fixture: every row already existed — the fixture is idempotent, so this is a ' +
                're-run against an already-seeded database, not a failure.',
        );
    }
} finally {
    await pool.end();
}
