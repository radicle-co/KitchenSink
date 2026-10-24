/**
 * Seed the local food store the SC-001 / SC-004 / SC-005 / SC-007 k6 scripts measure against, and emit the
 * `perf-fixture.json` they `open()`.
 *
 * The food mirror of identity's `tests/load/prepareDb.ts`, with two deliberate differences:
 *
 *  1. **It does NOT drop the schema.** Identity's step DROPs `public` and re-applies its migrations, which
 *     is safe only because the identity service is booted AFTER it. Here the service under test is already
 *     running (the erasure scenario ran first, inside its 120s token TTL), and a dropped schema would leave
 *     that container's 20-connection pool holding sessions against tables that no longer exist. So this
 *     script is purely ADDITIVE and idempotent (`ON CONFLICT DO NOTHING`), and it FAILS LOUDLY if the
 *     schema is absent instead of creating it — applying `src/db/migrations/*.sql` is the caller's job
 *     (`tests/load/README.md`, step 0).
 *  2. **Every population is set-based.** Each table is filled by one `INSERT … SELECT … FROM generate_series(…)`
 *     rather than a round trip per row. Row content is rendered by SQL fragments exported from `perfFixture.ts`
 *     alongside the TypeScript builders, and the two renderings are asserted to agree (see `assertRenderingsAgree`)
 *     rather than trusted by eye.
 *
 * ## What gets seeded, and why each population exists
 *
 * Two populations, split by who would write them in a stage (KTD-12): the SEEDED catalog the seed writes as
 * `food_seeder`, and the LIVE foods the service writes as `food_app`. The CLI writes both through one disposable
 * connection; `tests/e2e/perfFixtureDistribution.e2e.test.ts` writes each as its own role, which is what proves the
 * seeded half obeys the seed's ownership rule.
 *
 *  - **Seeded roots** (`FOOD_PERF_RESOLVED_FOODS`, default 50,000) — SC-007's stated population size
 *    ("a local store of up to 50,000 foods"). All of them carry a name, a description and a crosswalk row,
 *    so all three GIN indexes (`food_search_vector_idx`, `food_name_trgm_idx`,
 *    `food_description_trgm_idx`) hold 50,000 entries. This is what gives the search measurement its cost.
 *    Each owns a seed-owned item (`fdc:<key>`), so the change-refresh scan excludes it.
 *  - **Live variants** of those roots, drawn from the committed seed's variants-per-root distribution
 *    (`perfFixture.ts`, about 95,000 at the default size). Each owns a seed-owned item, its source row and exactly
 *    one nutrition header citing that item (KTD-19), so the variant read search issues and the variant list
 *    `GET /:id` returns both read real rows.
 *  - **Read targets** (`FOOD_PERF_READ_TARGETS`, default 5,000) — the leading slice of the seeded roots,
 *    given a FULL golden record (20 nutrients + 3 portions + scalar provenance + a barcode).
 *    5,000 is SC-004's stated warm-store threshold ("once the local store contains 5,000+ unique RESOLVED
 *    foods"), and these are the ids `localStoreRead.load.js` reads.
 *  - **`PENDING` foods** and **tombstoned `NOT_FOUND` foods** (default 500 each) — the LIVE population, and the
 *    NOT-served side of the SC-004 ratio. A read of one answers `202` / `404`: the caller got no food data, so the
 *    request was not served from the local store. Without them the serve rate would be 100% by construction and the
 *    SC-004 threshold could not fail for any reason.
 *
 * Usage (from packages/services/food-service):
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_load npm run test:load:fixture
 *   FOOD_PERF_RESOLVED_FOODS=5000 DATABASE_URL=… npm run test:load:fixture   # a fast smoke shape
 *
 * @pattern Object Mother — the SC-007 store, one set-based statement per table
 * @sideEffect Run as a script, writes about 2.9 million rows to `DATABASE_URL` (additively) and writes
 *            `perf-fixture.json` next to this script. Refuses any database not named in `perfFixture.ts`'s
 *            disposable allowlist. Imported, it does nothing until a seeding function is called.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pg from 'pg';

import { VARIANT_ATTRIBUTES } from '../../src/foods/foods.schema.js';
import {
    ALIAS_TERMS,
    BRAND_AXIS,
    CUT_AXIS,
    INGREDIENT_AXIS,
    PERF_RESOLVED_FOODS_DEFAULT,
    PERF_FIXTURE_FILENAME,
    PERF_NUTRIENTS,
    PERF_PORTION_LABELS,
    PERF_VARIANT_EXTERNAL_KEY_BASE,
    PREPARATIONS,
    VARIANT_COUNT_AXIS,
    VARIANT_PART_TEXTS,
    VARIANT_PARTS_AXIS,
    assertValidPerfId,
    buildSearchProbes,
    perfBarcode,
    perfBarcodeSql,
    perfFoodAliases,
    perfFoodAliasesSql,
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
    perfVariantCount,
    perfVariantExternalKey,
    perfVariantId,
    perfVariantIdSql,
    perfVariantIndex,
    perfVariantPartCountSql,
    perfVariantPartSql,
    perfVariantParts,
    perfVariantSeriesSql,
    perfVariantSourceIdSql,
    perfWordsSql,
    requireDisposableDatabaseUrl,
    type PerfFixtureFile,
    type PerfFoodKind,
} from './perfFixture.js';

/** The connection a seeding statement runs on: a pool, as the CLI and the e2e suite each open one. */
export type PerfFixtureDb = Pick<pg.Pool, 'query'>;

/** How many rows each population holds. */
export interface PerfFixtureSizes {
    /** Seeded roots: SC-007's population. */
    readonly resolvedFoods: number;
    /** The leading seeded roots that carry a full golden record: SC-004's warm store. */
    readonly readTargets: number;
    /** Live `PENDING` foods. */
    readonly pendingFoods: number;
    /** Live tombstoned `NOT_FOUND` foods. */
    readonly notFoundFoods: number;
}

/** Rows the seeded population inserted, by table. */
export interface SeededCatalogCounts {
    readonly roots: number;
    readonly rootSources: number;
    readonly variants: number;
    readonly variantParts: number;
    readonly variantSources: number;
    readonly rootNutrients: number;
    readonly variantNutrients: number;
    readonly portions: number;
    readonly provenance: number;
}

/** Rows the live population inserted. */
export interface LiveFoodCounts {
    readonly pending: number;
    readonly notFound: number;
}

/** The word arrays passed to every rendering statement, in placeholder order after `$1` (the count). */
const VOCAB_PARAMS = { preparations: 2, ingredients: 3, cuts: 4, brands: 5 } as const;

/**
 * ⛔ The three head-bearing parameters bind the axis's EXPANDED DRAW TABLE, not its vocabulary. The draw
 * table is what carries the Zipf weighting (plan U30) — binding the 36-word list instead would index it
 * modulo the axis cycle, land out of range for all but the first 36 slots, and silently return NULL for
 * every other row. `assertRenderingsAgree` catches that against a real Postgres, but the reason it can
 * only be the draw table belongs here, next to the binding.
 */
const vocabValues = [[...PREPARATIONS], [...INGREDIENT_AXIS.draw], [...CUT_AXIS.draw], [...BRAND_AXIS.draw]];

/**
 * Placeholder number for the {@link ALIAS_TERMS} array. Appended AFTER the existing `$6`-`$8` arguments
 * rather than inserted next to the other vocabularies, so no existing placeholder number moves — the
 * renderings above bind by number, and renumbering them is a silent-corruption change.
 */
const ALIAS_TERMS_PARAM = 9;

/** The variant renderings' placeholders: `$1` is the root count, `$2` the count axis's draw table. */
const VARIANT_PARAMS = { counts: 2 } as const;

/** The part rendering's placeholders, after {@link VARIANT_PARAMS}. */
const VARIANT_PART_PARAMS = { parts: 3, attributes: 4, texts: 5 } as const;

/** Every variant of the first `$1` seeded roots, as `s.i` and `v.idx`. */
const VARIANT_SERIES = perfVariantSeriesSql(1, VARIANT_PARAMS);

/** The tables the fixture writes, which `ANALYZE` refreshes after a bulk load. */
const SEEDED_TABLES = [
    'food',
    'food_item',
    'food_variant',
    'food_variant_part',
    'food_sources',
    'food_nutrition',
    'food_nutrition_citation',
    'food_nutrition_value',
    'food_portions',
    'food_field_provenance',
    'nutrient',
] as const;

/**
 * Require the food schema to already exist.
 *
 * @param db - The connection.
 * @throws When a table the fixture writes is absent.
 * @sideEffect Reads `information_schema`.
 */
async function requireSchema(db: PerfFixtureDb): Promise<void> {
    const { rows } = await db.query<{ present: number }>(
        `SELECT count(*)::int AS present
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [[...SEEDED_TABLES]],
    );

    if (rows[0]?.present !== SEEDED_TABLES.length) {
        throw new Error(
            'the food schema is not present in this database. This script is deliberately ADDITIVE and ' +
                'never creates it (the service under test is already connected). Apply the ordered DDL first:\n' +
                '  for f in src/db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done',
        );
    }
}

/**
 * Insert one `food` population.
 *
 * `search_vector` AND `aliases_search_vector` are STORED GENERATED columns and are deliberately absent
 * from the column list — Postgres computes both, which is exactly the write-side cost the deployed service
 * pays. `aliases` itself IS written, at USDA's measured ~1.8 per row: with it NULL the second vector would
 * be empty, its GIN index would hold nothing, and SC-007 would measure the alias branch doing no work.
 *
 * @param db - The connection.
 * @param kind - Which population to insert.
 * @param count - How many rows.
 * @param status - The `food.status` every row carries.
 * @param options - `barcodeBelow`: give a barcode to rows whose index is below this (0 = none);
 *   `tombstoned`: stamp `tombstoned_at` (the NOT_FOUND TTL clock, FR-025).
 * @returns The number of rows actually inserted.
 * @sideEffect Writes to `food_item` and `food`.
 */
async function insertFoods(
    db: PerfFixtureDb,
    kind: PerfFoodKind,
    count: number,
    status: 'RESOLVED' | 'PENDING' | 'NOT_FOUND',
    options: { readonly barcodeBelow: number; readonly tombstoned: boolean },
): Promise<number> {
    const name = perfFoodNameSql(kind, 's.i', VOCAB_PARAMS);
    const description = perfFoodDescriptionSql('s.i', VOCAB_PARAMS);
    const aliases = perfFoodAliasesSql('s.i', ALIAS_TERMS_PARAM, VOCAB_PARAMS.brands);
    // The SAME draw a row's name uses, so `brand_owner` / `brand_name` name the brand in the name.
    const brand = perfWordsSql('s.i', VOCAB_PARAMS).brand;
    // Each root owns its item (KTD-6), minted in the same statement as `'item-' || id`. The seeded population's items
    // carry a natural key equal to the crosswalk's fdc id, which makes them seed-owned (KTD-12): the change-refresh
    // scan skips them, and only the seed may write them. The live populations' items carry none.
    const seeded = kind === 'resolved';
    const result = await db.query(
        `WITH new_item AS (
             INSERT INTO food_item (id, natural_key, owner_kind)
             SELECT 'item-' || ${perfFoodIdSql(kind, 's.i')},
                    CASE WHEN $10::boolean THEN 'fdc:' || ($11::bigint + s.i)::text END,
                    'root'
               FROM generate_series(0, $1::int - 1) AS s(i)
             ON CONFLICT DO NOTHING
         )
         INSERT INTO food (
             id, item_id, seed_key, name, normalized_name, description, aliases, kind, brand_owner, brand_name, barcode,
             status, tombstoned_at, created_at, updated_at
         )
         SELECT ${perfFoodIdSql(kind, 's.i')},
                'item-' || ${perfFoodIdSql(kind, 's.i')},
                CASE WHEN $10::boolean THEN 'fdc:' || ($11::bigint + s.i)::text END,
                ${name},
                lower(${name}),
                ${description},
                ${aliases},
                CASE WHEN s.i % 3 = 0 THEN 'branded' ELSE 'generic' END::food_kind,
                CASE WHEN s.i % 3 = 0 THEN ${brand} || ' foods, inc.' END,
                CASE WHEN s.i % 3 = 0 THEN ${brand} END,
                CASE WHEN s.i < $6::int THEN ${perfBarcodeSql('s.i')} END,
                $7::food_status,
                CASE WHEN $8::boolean THEN now() END,
                now(), now()
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [
            count,
            ...vocabValues,
            options.barcodeBelow,
            status,
            options.tombstoned,
            [...ALIAS_TERMS],
            seeded,
            Number(perfExternalKey(kind, 0)),
        ],
    );

    return result.rowCount ?? 0;
}

/**
 * Insert one crosswalk row per food of a population, so every seeded food has the `food_sources` row a
 * real golden record has (and the composite per-value provenance FK has a target to reference).
 *
 * @param db - The connection.
 * @param kind - Which population.
 * @param count - How many rows.
 * @returns The number of rows inserted.
 * @sideEffect Writes to `food_sources`.
 */
async function insertSources(db: PerfFixtureDb, kind: PerfFoodKind, count: number): Promise<number> {
    const externalKeyBase = Number(perfExternalKey(kind, 0));
    const result = await db.query(
        `INSERT INTO food_sources (id, item_id, source, external_key, fetch_state, item_version, fetched_at)
         SELECT ${perfSourceIdSql(kind, 's.i')},
                'item-' || ${perfFoodIdSql(kind, 's.i')},
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
 * Insert every live variant of the first `rootCount` seeded roots, each with the seed-owned item it owns (KTD-6),
 * minted in the same statement as `'item-' || id`, with the natural key `fdc:<key>` its source row repeats.
 *
 * @param db - The connection.
 * @param rootCount - How many seeded roots.
 * @returns The number of variants inserted.
 * @sideEffect Writes to `food_item` and `food_variant`.
 */
async function insertVariants(db: PerfFixtureDb, rootCount: number): Promise<number> {
    const result = await db.query(
        `WITH new_variant AS (
             SELECT ${perfFoodIdSql('resolved', 's.i')} AS food_id, ${perfVariantIdSql('v.idx')} AS id, v.idx
             ${VARIANT_SERIES}
         ),
         new_item AS (
             INSERT INTO food_item (id, natural_key, owner_kind)
             SELECT 'item-' || id, 'fdc:' || ($3::bigint + idx)::text, 'variant' FROM new_variant
             ON CONFLICT DO NOTHING
         )
         INSERT INTO food_variant (id, food_id, item_id)
         SELECT id, food_id, 'item-' || id FROM new_variant
         ON CONFLICT DO NOTHING`,
        [rootCount, [...VARIANT_COUNT_AXIS.draw], PERF_VARIANT_EXTERNAL_KEY_BASE],
    );

    return result.rowCount ?? 0;
}

/**
 * Insert every variant's label parts.
 *
 * @param db - The connection.
 * @param rootCount - How many seeded roots.
 * @returns The number of parts inserted.
 * @sideEffect Writes to `food_variant_part`.
 */
async function insertVariantParts(db: PerfFixtureDb, rootCount: number): Promise<number> {
    const part = perfVariantPartSql('v.idx', 'p.k', VARIANT_PART_PARAMS);
    const partCount = perfVariantPartCountSql(VARIANT_PART_PARAMS.parts, 'v.idx');
    const result = await db.query(
        `INSERT INTO food_variant_part (variant_id, attribute, ordinal, text)
         SELECT ${perfVariantIdSql('v.idx')}, ${part.attribute}, 0, ${part.text}
         ${VARIANT_SERIES}
         CROSS JOIN LATERAL generate_series(0, ${partCount} - 1) AS p(k)
         ON CONFLICT DO NOTHING`,
        [
            rootCount,
            [...VARIANT_COUNT_AXIS.draw],
            [...VARIANT_PARTS_AXIS.draw],
            [...VARIANT_ATTRIBUTES],
            [...VARIANT_PART_TEXTS],
        ],
    );

    return result.rowCount ?? 0;
}

/**
 * Insert each variant's one usda source row, under the key its item's natural key names.
 *
 * @param db - The connection.
 * @param rootCount - How many seeded roots.
 * @returns The number of rows inserted.
 * @sideEffect Writes to `food_sources`.
 */
async function insertVariantSources(db: PerfFixtureDb, rootCount: number): Promise<number> {
    const result = await db.query(
        `INSERT INTO food_sources (id, item_id, source, external_key, fetch_state, item_version, fetched_at)
         SELECT ${perfVariantSourceIdSql('v.idx')}, 'item-' || ${perfVariantIdSql('v.idx')}, 'usda',
                ($3::bigint + v.idx)::text, 'fetched', '2026-01-01', now()
         ${VARIANT_SERIES}
         ON CONFLICT DO NOTHING`,
        [rootCount, [...VARIANT_COUNT_AXIS.draw], PERF_VARIANT_EXTERNAL_KEY_BASE],
    );

    return result.rowCount ?? 0;
}

/**
 * Seed the nutrient dictionary (one row per {@link PERF_NUTRIENTS} entry).
 *
 * @param db - The connection.
 * @returns The number of rows inserted.
 * @sideEffect Writes to `nutrient`.
 */
async function insertNutrientDictionary(db: PerfFixtureDb): Promise<number> {
    const result = await db.query(
        `INSERT INTO nutrient (id, name, unit, infoods_tag)
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
 * Each food gets one nutrition header and one citation of its own crosswalk item, and each value cites it through
 * the composite `(nutrition_id, citation_id)` key (KTD-19). Portions and provenance cite the food's OWN crosswalk row
 * through `(item_id, source_id) → food_sources(item_id, id)` (D-PROVENANCE-FK) — a shared source row would be
 * rejected, so this is also a live check that the fixture respects the real constraints.
 *
 * @param db - The connection.
 * @param count - How many read targets to enrich.
 * @returns Row counts per table.
 * @sideEffect Writes to the nutrition aggregate, `food_portions` and `food_field_provenance`.
 */
async function enrichReadTargets(
    db: PerfFixtureDb,
    count: number,
): Promise<{ nutrients: number; portions: number; provenance: number }> {
    const nutrientCount = PERF_NUTRIENTS.length;

    await db.query(
        `INSERT INTO food_nutrition (id, food_id)
         SELECT 'nh-' || ${perfFoodIdSql('resolved', 's.i')}, ${perfFoodIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [count],
    );
    await db.query(
        `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
         SELECT 'nc-' || ${perfFoodIdSql('resolved', 's.i')}, 'nh-' || ${perfFoodIdSql('resolved', 's.i')},
                'usdaSrFoundation', ($2::bigint + s.i)::text, 'exact'
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [count, Number(perfExternalKey('resolved', 0))],
    );

    const nutrients = await db.query(
        `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
         SELECT 'nh-' || ${perfFoodIdSql('resolved', 's.i')},
                ${perfRowIdSql('nutrient', 'D', 't.k')},
                -- Deterministic, non-negative (the food_nutrition_value_amount_nonneg CHECK), and varied enough
                -- that the numeric column stores real precision rather than 20 copies of one value.
                round((((s.i * 7 + t.k * 13) % 9973) / 100.0)::numeric, 3),
                'per_100g',
                'nc-' || ${perfFoodIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN generate_series(0, ${nutrientCount - 1}) AS t(k)
         ON CONFLICT DO NOTHING`,
        [count],
    );

    const portions = await db.query(
        `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
         SELECT ${perfRowIdSql('portion', 'W', `s.i * ${PERF_PORTION_LABELS.length} + t.k`)},
                'item-' || ${perfFoodIdSql('resolved', 's.i')},
                ($2::text[])[t.k + 1],
                -- Strictly positive (food_portions_gram_weight_pos).
                (10 + ((s.i + t.k) % 240))::numeric,
                ${perfSourceIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN generate_series(0, ${PERF_PORTION_LABELS.length - 1}) AS t(k)
         ON CONFLICT DO NOTHING`,
        [count, [...PERF_PORTION_LABELS]],
    );

    const provenance = await db.query(
        `INSERT INTO food_field_provenance (item_id, field, source_id)
         SELECT 'item-' || ${perfFoodIdSql('resolved', 's.i')}, t.field::food_field, ${perfSourceIdSql('resolved', 's.i')}
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN (VALUES ('name'), ('description'), ('kind')) AS t(field)
         ON CONFLICT (item_id, field) DO NOTHING`,
        [count],
    );

    return {
        nutrients: nutrients.rowCount ?? 0,
        portions: portions.rowCount ?? 0,
        provenance: provenance.rowCount ?? 0,
    };
}

/**
 * Give every variant its one nutrition header (KTD-19), one citation of its own item, and the {@link PERF_NUTRIENTS}
 * values, each citing that citation.
 *
 * @param db - The connection.
 * @param rootCount - How many seeded roots.
 * @returns The number of values inserted.
 * @sideEffect Writes to the nutrition aggregate.
 */
async function insertVariantNutrition(db: PerfFixtureDb, rootCount: number): Promise<number> {
    const variantId = perfVariantIdSql('v.idx');
    const params = [rootCount, [...VARIANT_COUNT_AXIS.draw]];

    await db.query(
        `INSERT INTO food_nutrition (id, food_variant_id)
         SELECT 'nh-' || ${variantId}, ${variantId}
         ${VARIANT_SERIES}
         ON CONFLICT DO NOTHING`,
        params,
    );
    await db.query(
        `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
         SELECT 'nc-' || ${variantId}, 'nh-' || ${variantId}, 'usdaSrFoundation', ($3::bigint + v.idx)::text, 'exact'
         ${VARIANT_SERIES}
         ON CONFLICT DO NOTHING`,
        [...params, PERF_VARIANT_EXTERNAL_KEY_BASE],
    );

    const values = await db.query(
        `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
         SELECT 'nh-' || ${variantId},
                ${perfRowIdSql('nutrient', 'D', 't.k')},
                round((((v.idx * 7 + t.k * 13) % 9973) / 100.0)::numeric, 3),
                'per_100g',
                'nc-' || ${variantId}
         ${VARIANT_SERIES}
         CROSS JOIN generate_series(0, ${PERF_NUTRIENTS.length - 1}) AS t(k)
         ON CONFLICT DO NOTHING`,
        params,
    );

    return values.rowCount ?? 0;
}

/**
 * Seed the SEEDED population: the roots, their live variants, their items, sources and nutrition, the nutrient
 * dictionary, and the read targets' golden records. Every row it writes is seed-owned or a dictionary entry, so
 * `food_seeder` may write all of it (KTD-12, KTD-13).
 *
 * @param db - The connection.
 * @param sizes - The population sizes.
 * @returns Rows inserted per table.
 * @sideEffect Writes the catalog tables and `nutrient`.
 */
export async function seedCatalogPopulation(db: PerfFixtureDb, sizes: PerfFixtureSizes): Promise<SeededCatalogCounts> {
    const roots = await insertFoods(db, 'resolved', sizes.resolvedFoods, 'RESOLVED', {
        barcodeBelow: sizes.readTargets,
        tombstoned: false,
    });
    const rootSources = await insertSources(db, 'resolved', sizes.resolvedFoods);
    const variants = await insertVariants(db, sizes.resolvedFoods);
    const variantParts = await insertVariantParts(db, sizes.resolvedFoods);
    const variantSources = await insertVariantSources(db, sizes.resolvedFoods);

    await insertNutrientDictionary(db);

    const enriched = await enrichReadTargets(db, sizes.readTargets);
    const variantNutrients = await insertVariantNutrition(db, sizes.resolvedFoods);

    return {
        roots,
        rootSources,
        variants,
        variantParts,
        variantSources,
        rootNutrients: enriched.nutrients,
        variantNutrients,
        portions: enriched.portions,
        provenance: enriched.provenance,
    };
}

/**
 * Seed the LIVE population: `PENDING` and tombstoned `NOT_FOUND` foods with their unseeded items and crosswalk rows,
 * which the service role may write and the seeder may not (KTD-12).
 *
 * @param db - The connection.
 * @param sizes - The population sizes.
 * @returns Foods inserted per status.
 * @sideEffect Writes `food_item`, `food` and `food_sources`.
 */
export async function seedLivePopulation(db: PerfFixtureDb, sizes: PerfFixtureSizes): Promise<LiveFoodCounts> {
    const pending = await insertFoods(db, 'pending', sizes.pendingFoods, 'PENDING', {
        barcodeBelow: 0,
        tombstoned: false,
    });
    const notFound = await insertFoods(db, 'notFound', sizes.notFoundFoods, 'NOT_FOUND', {
        barcodeBelow: 0,
        tombstoned: true,
    });

    await insertSources(db, 'pending', sizes.pendingFoods);
    await insertSources(db, 'notFound', sizes.notFoundFoods);

    return { pending, notFound };
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
 * @param db - The connection.
 * @param kind - Which population to probe.
 * @param expectBarcode - Whether row 0 of this population should carry a barcode (the crosswalk target).
 * @throws On a mismatch.
 * @sideEffect Reads `food`/`food_sources`.
 */
async function assertRenderingsAgree(db: PerfFixtureDb, kind: PerfFoodKind, expectBarcode: boolean): Promise<void> {
    const id = perfFoodId(kind, 0);
    assertValidPerfId(id);

    const { rows } = await db.query<{
        name: string | null;
        normalized_name: string;
        description: string | null;
        aliases: string | null;
        barcode: string | null;
        external_key: string | null;
    }>(
        `SELECT f.name, f.normalized_name, f.description, f.aliases, f.barcode, s.external_key
           FROM food f LEFT JOIN food_sources s ON s.item_id = f.item_id
          WHERE f.id = $1`,
        [id],
    );

    const actual = rows[0];
    const expected = {
        name: perfFoodName(kind, 0),
        normalized_name: perfNormalizedName(kind, 0),
        description: perfFoodDescription(0),
        aliases: perfFoodAliases(0),
        barcode: expectBarcode ? perfBarcode(0) : null,
        external_key: perfExternalKey(kind, 0),
    };

    if (
        actual === undefined ||
        actual.name !== expected.name ||
        actual.normalized_name !== expected.normalized_name ||
        actual.description !== expected.description ||
        actual.aliases !== expected.aliases ||
        actual.barcode !== expected.barcode ||
        actual.external_key !== expected.external_key
    ) {
        throw new Error(
            `the SQL rendering of the '${kind}' population does not match perfFixture.ts. Expected ` +
                `${JSON.stringify(expected)}, database has ${JSON.stringify(actual ?? null)}. The emitted ` +
                `fixture ids would name rows that do not exist.`,
        );
    }
}

/**
 * Prove the variant rendering matches the TypeScript builders: the whole population's variant count, and the first
 * root with a variant's variants, keys and parts, row by row.
 *
 * @param db - The connection.
 * @param rootCount - How many seeded roots.
 * @throws On a mismatch.
 * @sideEffect Reads the variant tables, `food_item`, `food_sources` and the citations.
 */
async function assertVariantRenderingAgrees(db: PerfFixtureDb, rootCount: number): Promise<void> {
    const rootIndexes = Array.from({ length: rootCount }, (_unused, index) => index);
    const expectedTotal = rootIndexes.reduce((sum, index) => sum + perfVariantCount(index), 0);
    const rootIndex = rootIndexes.find((index) => perfVariantCount(index) > 0);
    const { rows: totals } = await db.query<{ variants: number }>(
        `SELECT count(*)::int AS variants FROM food_variant WHERE id LIKE $1`,
        [`${perfVariantId(0).slice(0, 11)}%`],
    );

    if (totals[0]?.variants !== expectedTotal || rootIndex === undefined) {
        throw new Error(
            `the database holds ${totals[0]?.variants ?? 'no'} fixture variants and perfFixture.ts draws ` +
                `${expectedTotal} for ${rootCount} roots. The variant rendering and the TypeScript disagree.`,
        );
    }

    const expected = Array.from({ length: perfVariantCount(rootIndex) }, (_unused, slot) => {
        const variantIndex = perfVariantIndex(rootIndex, slot);
        const key = perfVariantExternalKey(variantIndex);

        return {
            id: perfVariantId(variantIndex),
            naturalKey: `fdc:${key}`,
            sourceKey: key,
            citationKey: key,
            parts: perfVariantParts(variantIndex).map((part) => `${part.attribute}:${part.text}`),
        };
    });
    const { rows } = await db.query<(typeof expected)[number]>(
        `SELECT v.id,
                i.natural_key AS "naturalKey",
                s.external_key AS "sourceKey",
                c.external_key AS "citationKey",
                array(SELECT p.attribute::text || ':' || p.text FROM food_variant_part p
                       WHERE p.variant_id = v.id ORDER BY p.attribute, p.ordinal) AS parts
           FROM food_variant v
           JOIN food_item i ON i.id = v.item_id
           LEFT JOIN food_sources s ON s.item_id = v.item_id
           LEFT JOIN food_nutrition h ON h.food_variant_id = v.id
           LEFT JOIN food_nutrition_citation c ON c.nutrition_id = h.id
          WHERE v.food_id = $1
          ORDER BY v.id`,
        [perfFoodId('resolved', rootIndex)],
    );

    if (JSON.stringify(rows) !== JSON.stringify(expected)) {
        throw new Error(
            `the variants of root ${perfFoodId('resolved', rootIndex)} do not match perfFixture.ts. Expected ` +
                `${JSON.stringify(expected)}, database has ${JSON.stringify(rows)}.`,
        );
    }
}

/**
 * Prove a read target really is readable as a golden record — the exact shape `GET /api/v1/foods/{id}`
 * serves. A read target with zero nutrients would make SC-001 measure an empty aggregate.
 *
 * @param db - The connection.
 * @throws When the golden record is incomplete.
 * @sideEffect Reads the value tables.
 */
async function assertGoldenRecordDepth(db: PerfFixtureDb): Promise<void> {
    const id = perfFoodId('resolved', 0);
    const { rows } = await db.query<{ nutrients: number; portions: number; provenance: number; sources: number }>(
        `SELECT (SELECT count(*)::int FROM food_nutrient_view WHERE food_id = $1)                    AS nutrients,
                (SELECT count(*)::int FROM food_portions WHERE item_id = 'item-' || $1)         AS portions,
                (SELECT count(*)::int FROM food_field_provenance WHERE item_id = 'item-' || $1) AS provenance,
                (SELECT count(*)::int FROM food_sources WHERE item_id = 'item-' || $1)          AS sources`,
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
        throw new Error(
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
 * @param db - The connection.
 * @param probes - The emitted probe set.
 * @throws When a probe is mis-calibrated.
 * @sideEffect Reads `food`.
 */
async function assertProbeSelectivity(
    db: PerfFixtureDb,
    probes: { broad: readonly string[]; miss: readonly string[]; alias: readonly string[] },
): Promise<void> {
    const broad = probes.broad[0]!;
    const miss = probes.miss[0]!;
    const alias = probes.alias[0]!;
    const { rows } = await db.query<{
        broad_matches: number;
        miss_matches: number;
        alias_matches: number;
        alias_via_other_branches: number;
    }>(
        `SELECT (SELECT count(*)::int FROM food
                  WHERE status = 'RESOLVED' AND search_vector @@ plainto_tsquery('english', $1)) AS broad_matches,
                (SELECT count(*)::int FROM food
                  WHERE status = 'RESOLVED' AND (search_vector @@ plainto_tsquery('english', $2)
                        OR aliases_search_vector @@ plainto_tsquery('english', $2)
                        OR name % $2::text
                        OR name ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%')) AS miss_matches,
                (SELECT count(*)::int FROM food
                  WHERE status = 'RESOLVED'
                    AND aliases_search_vector @@ plainto_tsquery('english', $3)) AS alias_matches,
                (SELECT count(*)::int FROM food
                  WHERE status = 'RESOLVED' AND (search_vector @@ plainto_tsquery('english', $3)
                        OR name % $3::text
                        OR name ILIKE '%' || $3 || '%'
                        OR description ILIKE '%' || $3 || '%')) AS alias_via_other_branches`,
        [broad, miss, alias],
    );
    const actual = rows[0];

    if (actual === undefined || actual.broad_matches <= 20) {
        throw new Error(
            `the broad search probe '${broad}' matches ${actual?.broad_matches ?? 'unknown'} RESOLVED rows, ` +
                `which does not exceed the endpoint's 20-row limit — the measurement would report a ` +
                `short-circuited scan as a full ranked search. Seed more foods (FOOD_PERF_RESOLVED_FOODS).`,
        );
    }

    if (actual.miss_matches !== 0) {
        throw new Error(
            `the miss probe '${miss}' matches ${actual.miss_matches} row(s); it must match ZERO so the ` +
                `predicate is evaluated in full. The vocabulary in perfFixture.ts must have changed.`,
        );
    }

    // U2: the alias shape has to be answered BY the alias vector and by nothing else. Both halves matter —
    // zero alias matches means the seed left `aliases` NULL and the k6 `alias` shape would time an empty
    // GIN scan; a non-zero count on the other branches means the alias vocabulary has collided with the
    // name/description vocabulary and the shape no longer isolates the branch it exists to measure.
    if (actual.alias_matches === 0) {
        throw new Error(
            `the alias probe '${alias}' matches NO rows through aliases_search_vector. The seeded ` +
                `food.aliases column is empty or the alias vocabulary drifted from perfFoodAliases(), so ` +
                `the k6 'alias' shape would report the speed of scanning an empty index.`,
        );
    }

    if (actual.alias_via_other_branches !== 0) {
        throw new Error(
            `the alias probe '${alias}' also matches ${actual.alias_via_other_branches} row(s) through ` +
                `name/description. ALIAS_TERMS must share no token with the name vocabulary, or the shape ` +
                `stops isolating the curated-alias branch.`,
        );
    }
}

/**
 * Read a positive population size from the environment.
 *
 * @param name - The variable.
 * @param fallback - Its default.
 * @returns The size, at least 1.
 * @sideEffect Reads `process.env`.
 */
function sizeFromEnv(name: string, fallback: number): number {
    return Math.max(1, Number(process.env[name] ?? fallback));
}

/**
 * Seed the store, check it, and write `perf-fixture.json`. Fails with a non-zero exit and an actionable message, never
 * warn-and-continue: a fixture that half-seeded is a run that measures the wrong store while reporting green.
 *
 * @sideEffect Connects to `DATABASE_URL`, writes the fixture's rows and the JSON file, and sets the exit code.
 */
async function main(): Promise<void> {
    const connectionString = requireDisposableDatabaseUrl();
    const resolvedFoods = sizeFromEnv('FOOD_PERF_RESOLVED_FOODS', PERF_RESOLVED_FOODS_DEFAULT);
    const sizes: PerfFixtureSizes = {
        resolvedFoods,
        // SC-004's warm-store threshold, and the read population for SC-001/SC-005.
        readTargets: Math.min(resolvedFoods, sizeFromEnv('FOOD_PERF_READ_TARGETS', 5_000)),
        pendingFoods: sizeFromEnv('FOOD_PERF_PENDING_FOODS', 500),
        notFoundFoods: sizeFromEnv('FOOD_PERF_NOT_FOUND_FOODS', 500),
    };
    // How many distinct probes of each search shape to emit (the scripts rotate through them).
    const searchProbes = sizeFromEnv('FOOD_PERF_SEARCH_PROBES', 32);
    const pool = new pg.Pool({ connectionString });

    try {
        await requireSchema(pool);

        const catalog = await seedCatalogPopulation(pool, sizes);
        const live = await seedLivePopulation(pool, sizes);

        // The planner's choice for every search predicate depends on table statistics, and a freshly
        // bulk-loaded table has none — leaving SC-007 measuring a plan the deployed service would never
        // choose. ANALYZE makes the measured plan the honest one. (Identity's prepare-db does the same for
        // the admin scan, for the same reason.)
        await pool.query(`ANALYZE ${SEEDED_TABLES.join(', ')}`);

        await assertRenderingsAgree(pool, 'resolved', true);
        await assertRenderingsAgree(pool, 'pending', false);
        await assertRenderingsAgree(pool, 'notFound', false);
        await assertVariantRenderingAgrees(pool, sizes.resolvedFoods);
        await assertGoldenRecordDepth(pool);

        const search = buildSearchProbes(searchProbes);
        await assertProbeSelectivity(pool, search);

        const fixture: PerfFixtureFile = {
            generatedAt: new Date().toISOString(),
            resolvedFoods: sizes.resolvedFoods,
            readTargets: sizes.readTargets,
            resolvedIds: Array.from({ length: sizes.readTargets }, (_unused, index) => perfFoodId('resolved', index)),
            pendingIds: Array.from({ length: sizes.pendingFoods }, (_unused, index) => perfFoodId('pending', index)),
            notFoundIds: Array.from({ length: sizes.notFoundFoods }, (_unused, index) => perfFoodId('notFound', index)),
            search,
        };

        writeFileSync(join(dirname(fileURLToPath(import.meta.url)), PERF_FIXTURE_FILENAME), JSON.stringify(fixture));

        console.log(
            `prepare-perf-fixture: inserted ${catalog.roots} seeded roots with ${catalog.variants} live variants ` +
                `(${catalog.variantParts} parts), ${live.pending} PENDING + ${live.notFound} NOT_FOUND foods, ` +
                `${catalog.rootSources + catalog.variantSources} crosswalk rows, ${catalog.rootNutrients} root and ` +
                `${catalog.variantNutrients} variant nutrient values, ${catalog.portions} portions, ` +
                `${catalog.provenance} provenance rows; barcode on the first ${sizes.readTargets}; wrote ` +
                `${PERF_FIXTURE_FILENAME} (${fixture.resolvedIds.length} read targets, ${searchProbes} probes per ` +
                `search shape).`,
        );

        if (catalog.roots === 0 && live.pending === 0 && live.notFound === 0) {
            console.log(
                'prepare-perf-fixture: every row already existed — the fixture is idempotent, so this is a ' +
                    're-run against an already-seeded database, not a failure.',
            );
        }
    } catch (error) {
        console.error(`prepare-perf-fixture: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
