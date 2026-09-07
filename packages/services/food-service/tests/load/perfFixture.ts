/**
 * The ONE definition of the food performance fixture — the id scheme, the name vocabulary, the search
 * probe set and the disposable-database guard shared by `preparePerfFixture.ts` (which seeds Postgres)
 * and `drainDemotion.perf.ts` (which seeds the queue). The k6 scripts never re-derive any of it: they
 * `open()` the JSON `preparePerfFixture.ts` emits, so a fixture rule lives here exactly once.
 *
 * Mirrors identity's `tests/load/poolIdentities.ts`. It is TypeScript (run under `tsx`), NOT part of the
 * k6 `lib/` directory — `lib/*.js` is goja-only and may import nothing but k6 built-ins.
 *
 * ## Why the ids are DETERMINISTIC
 *
 * Every fixture row's `food.id` is a function of its kind + index, so a re-run seeds the same ids, the
 * seed is idempotent (`ON CONFLICT DO NOTHING`), and the SQL that bulk-inserts 50,000 rows can render an
 * id inline (`'01JPERF000R' || lpad(i::text, 15, '0')`) instead of shipping a 50,000-element array. Both
 * renderings — this module's {@link perfFoodId} and the SQL fragment — are asserted to agree by the
 * seeder, exactly as identity's `prepareDb.ts` proves its bulk SQL matches `bulkIdentity(0)`.
 *
 * A ULID is 26 Crockford-base32 characters whose first character is `<= '7'`. `01JPERF000` is a valid
 * 10-character timestamp part, the kind letter is in the alphabet, and the DECIMAL DIGITS of a
 * zero-padded index are all in the alphabet too — which is what lets the same id be rendered in pure SQL
 * with `lpad`. `ulidx`'s `isFoodId` accepts the result (asserted in the seeder), so these ids pass the
 * controller's `400`-on-malformed-id validation like any real food id.
 */
import { isFoodId } from '../../src/db/ulid.js';
import { type DrawAxis, buildDrawAxis, drawFrom, drawFromSql } from './headTermSelectivity.js';

/**
 * Fixed 10-character ULID timestamp parts, one per table whose surrogate key the fixture mints. Constant
 * (not `Date.now()`) so ids are reproducible across runs; `0`-led so each is a legal ULID timestamp. One
 * space per table keeps a `food_sources.id` and a `food.id` textually distinguishable in a failure dump.
 */
export const PERF_ID_SPACE = {
    food: '01JPERF000',
    source: '01JPERF001',
    nutrient: '01JPERF002',
    nutrientValue: '01JPERF003',
    portion: '01JPERF004',
} as const;

/** Which table's key space an id belongs to. */
export type PerfIdSpace = keyof typeof PERF_ID_SPACE;

/** Width of the zero-padded decimal index that completes a fixture id (10 + 1 + 15 = 26). */
export const PERF_INDEX_PAD = 15;

/**
 * A deterministic 26-character ULID in the given key space. Pure.
 *
 * @param space - Which table's key space to mint in.
 * @param letter - A single Crockford-base32 discriminator character.
 * @param index - Zero-based row index.
 * @returns A valid ULID.
 */
export function perfRowId(space: PerfIdSpace, letter: string, index: number): string {
    return `${PERF_ID_SPACE[space]}${letter}${String(index).padStart(PERF_INDEX_PAD, '0')}`;
}

/**
 * The SQL expression rendering {@link perfRowId} for a `generate_series` column. Kept beside the
 * TypeScript so the two cannot drift unnoticed; the seeder asserts they agree.
 *
 * @param space - Which table's key space to mint in.
 * @param letter - A single Crockford-base32 discriminator character.
 * @param expression - The SQL integer expression holding the index (e.g. `s.i` or `s.i * 20 + t.k`).
 * @returns A SQL scalar expression producing the id.
 */
export function perfRowIdSql(space: PerfIdSpace, letter: string, expression: string): string {
    return `'${PERF_ID_SPACE[space]}${letter}' || lpad((${expression})::text, ${PERF_INDEX_PAD}, '0')`;
}

/**
 * What a fixture food is for. The letter is embedded in the id, so a row's role is readable from its id
 * in a log line, a failing check or a `psql` session.
 *
 * - `resolved` (`R`) — a `RESOLVED` golden record. The SC-001/SC-005/SC-007 population.
 * - `pending` (`P`) — a `PENDING` food. Read answers `202`: NOT served from the local store (SC-004).
 * - `notFound` (`N`) — a tombstoned `NOT_FOUND` food. Read answers `404`: also not served (SC-004).
 * - `queue` (`Q`) — a `PENDING` food owned by the drain/demotion probe (DSN-11), kept in its own id
 *   space so seeding the queue can never collide with the read/search population's `normalized_name`.
 */
export type PerfFoodKind = 'resolved' | 'pending' | 'notFound' | 'queue';

/** The id letter per kind. Read by both the TypeScript builder and the seeder's SQL. */
export const PERF_KIND_LETTER: Readonly<Record<PerfFoodKind, string>> = {
    resolved: 'R',
    pending: 'P',
    notFound: 'N',
    queue: 'Q',
};

/**
 * The deterministic `food.id` for a fixture row. Pure.
 *
 * @param kind - Which population the row belongs to.
 * @param index - Zero-based index within that population.
 * @returns A valid 26-character ULID.
 */
export function perfFoodId(kind: PerfFoodKind, index: number): string {
    return perfRowId('food', PERF_KIND_LETTER[kind], index);
}

/**
 * The SQL expression that renders {@link perfFoodId} for a `generate_series` column. Kept beside the
 * TypeScript so the two cannot drift unnoticed; the seeder asserts they agree.
 *
 * @param kind - Which population the row belongs to.
 * @param column - The series column holding the index (e.g. `s.i`).
 * @returns A SQL scalar expression producing the id.
 */
export function perfFoodIdSql(kind: PerfFoodKind, column: string): string {
    return perfRowIdSql('food', PERF_KIND_LETTER[kind], column);
}

/**
 * The deterministic `food_sources.id` for a fixture food's single crosswalk row. Pure.
 *
 * Keyed by KIND as well as index: a shared letter would make every population's crosswalk row collide on
 * the primary key, and because the seeder inserts `ON CONFLICT (id) DO NOTHING`, the collisions would be
 * silently skipped — leaving the `PENDING`/`NOT_FOUND` foods with no crosswalk row at all.
 *
 * @param kind - Which population the owning food belongs to.
 * @param index - Zero-based index within that population.
 * @returns A valid ULID.
 */
export function perfSourceId(kind: PerfFoodKind, index: number): string {
    return perfRowId('source', PERF_KIND_LETTER[kind], index);
}

/** The SQL expression rendering {@link perfSourceId}. */
export function perfSourceIdSql(kind: PerfFoodKind, column: string): string {
    return perfRowIdSql('source', PERF_KIND_LETTER[kind], column);
}

/** Assert a rendered fixture id is a structurally valid ULID (the controller `400`s on anything else). */
export function assertValidPerfId(id: string): void {
    if (!isFoodId(id)) {
        throw new Error(
            `perf-fixture: '${id}' is not a valid ULID, so FoodsController would answer 400 for every ` +
                `read of it — the whole run would measure input validation instead of the local store.`,
        );
    }
}

// ── Name vocabulary ───────────────────────────────────────────────────────────────────────────
//
// A golden `name` is `<preparation> <ingredient> <cut>, <brand> <serial>`, and the description repeats
// the same words in prose. The three head-bearing lists give the SC-007 search probes a KNOWN selectivity
// against the seeded population, which is what makes a search measurement interpretable rather than
// merely a number.
//
// ⛔ THE LISTS ARE ORDERED BY DESIGNED SELECTIVITY, BROADEST FIRST, AND REORDERING ONE RE-WEIGHTS IT.
// Each is drawn through a weighted `DrawAxis` (`headTermSelectivity.ts`) rather than by
// `index % length`, because uniform is the one shape the real catalog is NOT. See that module for the
// measurements and the arithmetic; the short version is that `FoodSearchDao.relevanceQuery` retrieves on
// the query's head term, the real 8,094-row USDA catalog puts that term's selectivity at 1.89% (p50) and
// 13.75% (worst realistic), and this fixture used to put every term at a flat 4.35% / 9.09% / 5.88%.
//
// `PREPARATIONS` stays UNIFORM and stays at seven, deliberately: no probe shape ever heads on a
// preparation word (`"raw chicken"`'s head is `chicken`, `"raw chicken breast"`'s is `breast`), so
// skewing it would model nothing while making the `phrase` conjunction harder to reason about.

/** Leading preparation word (7) — never a head term, so deliberately left uniform. */
export const PREPARATIONS = ['raw', 'cooked', 'roasted', 'canned', 'frozen', 'dried', 'grilled'] as const;

/** Ingredient head noun — the `broad` and `phrase` probes' head axis. Broadest first. */
export const INGREDIENTS = [
    'chicken',
    'beef',
    'pork',
    'rice',
    'potato',
    'tomato',
    'onion',
    'cheddar',
    'apple',
    'carrot',
    'salmon',
    'spinach',
    'broccoli',
    'banana',
    'oat',
    'yogurt',
    'tuna',
    'almond',
    'lentil',
    'mushroom',
    'pepper',
    'garlic',
    'celery',
    'cucumber',
    'blueberry',
    'walnut',
    'quinoa',
    'barley',
    'chickpea',
    'mozzarella',
    'cabbage',
    'zucchini',
    'apricot',
    'papaya',
    'turnip',
    'tarragon',
] as const;

/** Cut / form qualifier — the `narrow` probe's head axis. Broadest first. */
export const CUTS = [
    'sliced',
    'diced',
    'ground',
    'whole',
    'breast',
    'thigh',
    'fillet',
    'shredded',
    'flour',
    'puree',
    'flakes',
    'cubed',
    'minced',
    'chopped',
    'grated',
    'crushed',
    'mashed',
    'julienne',
    'wedge',
    'chunk',
    'strip',
    'loin',
    'rib',
    'shank',
    'flank',
    'brisket',
    'tenderloin',
    'drumstick',
    'wing',
    'cutlet',
    'medallion',
    'paste',
    'powder',
    'meal',
    'bran',
    'kernel',
] as const;

/** Brand token — the `brand` and `alias` probes' head axis, independent of the ingredient axis. */
export const BRANDS = [
    'northvale',
    'harborline',
    'stonefield',
    'brightoak',
    'clearwater',
    'goldenrow',
    'ironhill',
    'meadowcrest',
    'sunpath',
    'redfern',
    'bluestem',
    'quarrylane',
    'wildbank',
    'fernmoor',
    'silverpine',
    'oakhollow',
    'thornbury',
    'elmridge',
    'larkfield',
    'cedarmont',
    'willowgate',
    'ambervale',
    'foxglen',
    'hartwell',
    'mossbank',
    'pinewick',
    'rookcliff',
    'sandhaven',
    'thistledown',
    'valeport',
    'westmere',
    'yewbrook',
    'alderpond',
    'birchgate',
    'cranemoor',
    'dunhollow',
] as const;

// ── The weighted draw axes ────────────────────────────────────────────────────────────────
//
// ⚠️ The three cycles are DISTINCT PRIMES and each stride is its own. Both facts are load-bearing and
// neither is decoration: a shared cycle makes one axis a function of another (`i % 997` determines
// `(i * k) % 997`), and blocked expansion over two nearby cycles correlates them along the diagonal where
// both residues stay small — measured at ~6.7x the independent joint count. `perfFixtureDistribution.test.ts`
// asserts the realized independence rather than trusting either argument.

/** The ingredient draw axis — the `broad` / `phrase` probes' head selectivity. */
export const INGREDIENT_AXIS = buildDrawAxis('ingredient', INGREDIENTS, 997, 617);

/** The cut draw axis — the `narrow` probe's head selectivity. */
export const CUT_AXIS = buildDrawAxis('cut', CUTS, 1009, 631);

/** The brand draw axis — the `brand` / `alias` probes' head selectivity. */
export const BRAND_AXIS = buildDrawAxis('brand', BRANDS, 1013, 647);

/** Every axis a search probe can head on, by name. */
export const HEAD_TERM_AXES = {
    ingredient: INGREDIENT_AXIS,
    cut: CUT_AXIS,
    brand: BRAND_AXIS,
} as const satisfies Readonly<Record<string, DrawAxis>>;

/** SC-007's population size — the default `preparePerfFixture.ts` seeds and the guards measure against. */
export const PERF_RESOLVED_FOODS_DEFAULT = 50_000;

/** The four vocabulary words a fixture row's name, description and aliases are all built from. */
export interface PerfWords {
    /** Leading preparation word, drawn uniformly — never a head term. */
    readonly preparation: string;
    /** Ingredient head noun, drawn through {@link INGREDIENT_AXIS}. */
    readonly ingredient: string;
    /** Cut / form qualifier, drawn through {@link CUT_AXIS}. */
    readonly cut: string;
    /** Brand token, drawn through {@link BRAND_AXIS}. */
    readonly brand: string;
}

/**
 * The words a row index draws. Pure — and the ONE place the four draws are expressed, so a name, its
 * description and its aliases can never disagree about which brand a row carries.
 *
 * @param index - Zero-based index within the population.
 * @returns The drawn words.
 */
export function perfWords(index: number): PerfWords {
    return {
        preparation: PREPARATIONS[index % PREPARATIONS.length]!,
        ingredient: drawFrom(INGREDIENT_AXIS, index),
        cut: drawFrom(CUT_AXIS, index),
        brand: drawFrom(BRAND_AXIS, index),
    };
}

/** 1-based placeholder numbers for the four word arrays a rendering statement binds. */
export interface PerfWordParams {
    /** Holds {@link PREPARATIONS} verbatim. */
    readonly preparations: number;
    /** Holds `INGREDIENT_AXIS.draw` — the EXPANDED table, not the vocabulary. */
    readonly ingredients: number;
    /** Holds `CUT_AXIS.draw`. */
    readonly cuts: number;
    /** Holds `BRAND_AXIS.draw`. */
    readonly brands: number;
}

/**
 * The SQL mirror of {@link perfWords}. Pure; the seeder asserts the two agree against a real Postgres.
 *
 * @param column - The SQL integer expression holding the row index.
 * @param params - Placeholder numbers, per {@link PerfWordParams}.
 * @returns One SQL scalar expression per word.
 */
export function perfWordsSql(column: string, params: PerfWordParams): Readonly<Record<keyof PerfWords, string>> {
    return {
        preparation: `($${params.preparations}::text[])[(${column} % ${PREPARATIONS.length}) + 1]`,
        ingredient: drawFromSql(INGREDIENT_AXIS, params.ingredients, column),
        cut: drawFromSql(CUT_AXIS, params.cuts, column),
        brand: drawFromSql(BRAND_AXIS, params.brands, column),
    };
}

// ── Curated-alias vocabulary (U2) ───────────────────────────────────────────────────────────────
//
// `food.aliases` is a SECOND free-text column with a SECOND STORED generated tsvector and a SECOND GIN
// index, and `FoodSearchDao.relevanceQuery` now ORs that vector into its predicate and its `GREATEST`.
// If the fixture left `aliases` NULL on every row — as it did before U2 — the vector would be empty, the
// index would hold nothing, and the SC-007 measurement would report the speed of DOING NO WORK while the
// deployed store carried ~1.8 aliases per row (USDA FNDDS: 9,648 additional descriptions across 5,432
// main descriptions). The gate would pass for the wrong reason, which is worse than failing.
//
// ⛔ The vocabulary is its OWN axis, sharing no token with the name/description vocabularies above. If an
// alias reused an ingredient word, an alias probe would match through `search_vector` anyway and the new
// branch would still never be exercised.

/** Alias head token (13) — brand-ish/regional synonyms, disjoint from every other vocabulary. */
export const ALIAS_TERMS = [
    'tillamook',
    'longhorn',
    'coonridge',
    'hoopwell',
    'marbledale',
    'kettlebrook',
    'pinecliff',
    'ambergate',
    'foxwater',
    'briarmill',
    'saltmarsh',
    'copperfen',
    'yarrowdale',
] as const;

/**
 * How many aliases each fixture food carries, by index — 2 for four rows in five and 1 for the fifth,
 * i.e. a mean of exactly **1.8**, USDA's measured density (9,648 / 5,432 = 1.776). The cycle is 5 and the
 * vocabularies are 13/17, so alias assignment spreads evenly across the population instead of clustering.
 *
 * @param index - Zero-based index within the population.
 * @returns 1 or 2.
 */
export function perfAliasCount(index: number): number {
    return index % 5 === 0 ? 1 : 2;
}

/**
 * The stored `food.aliases` text for a fixture food — the flattened form `foodAliases.joinAliases`
 * produces, `'; '`-separated. Pure.
 *
 * Each alias is `<aliasTerm> <brand>`, which makes it two lexemes (so `ts_rank` has something to rank)
 * and unique enough across 50,000 rows that the alias GIN index holds a realistic number of distinct
 * postings rather than 13 enormous ones.
 *
 * @param index - Zero-based index within the population.
 * @returns The stored alias text.
 */
export function perfFoodAliases(index: number): string {
    const { brand } = perfWords(index);

    return Array.from(
        { length: perfAliasCount(index) },
        (_unused, slot) => `${ALIAS_TERMS[(index + slot) % ALIAS_TERMS.length]} ${brand}`,
    ).join('; ');
}

/**
 * The SQL expression rendering {@link perfFoodAliases}; the seeder asserts the two agree.
 *
 * The 1-vs-2 alias split is a `CASE`, not an `array_agg` loop, because the count is only ever 1 or 2 —
 * spelling it out keeps the rendering readable and provably identical to the TypeScript above.
 *
 * @param column - The series column holding the index.
 * @param aliasTermsParam - 1-based placeholder number for the {@link ALIAS_TERMS} array.
 * @param brandsParam - 1-based placeholder number for `BRAND_AXIS.draw` (the expanded table).
 * @returns A SQL scalar expression producing the stored alias text.
 */
export function perfFoodAliasesSql(column: string, aliasTermsParam: number, brandsParam: number): string {
    const brand = drawFromSql(BRAND_AXIS, brandsParam, column);
    const term = (slot: number): string =>
        `($${aliasTermsParam}::text[])[((${column} + ${slot}) % ${ALIAS_TERMS.length}) + 1]`;
    const alias = (slot: number): string => `${term(slot)} || ' ' || ${brand}`;

    return `CASE WHEN ${column} % 5 = 0 THEN ${alias(0)} ELSE ${alias(0)} || '; ' || ${alias(1)} END`;
}

/** Width of the zero-padded serial embedded in a name (its uniqueness discriminator). */
const SERIAL_PAD = 6;

/**
 * The golden `name` for a fixture food. Pure.
 *
 * The trailing zero-padded serial is what makes `normalized_name` unique across 50,000 rows — the
 * vocabulary's cross product is only 7 x 36 x 36 x 36 = 326,592 combinations and the WEIGHTED draw
 * concentrates most rows on far fewer, so a purely lexical name would collide against
 * `food_normalized_name_unique` and the seed would silently insert fewer rows than requested.
 *
 * @param kind - Which population the row belongs to (kept in the name so a stray row is traceable).
 * @param index - Zero-based index within that population.
 * @returns The display name.
 */
export function perfFoodName(kind: PerfFoodKind, index: number): string {
    const { preparation, ingredient, cut, brand } = perfWords(index);

    return (
        `${preparation} ${ingredient} ${cut}, ${brand} ` +
        `${PERF_KIND_LETTER[kind]}${String(index).padStart(SERIAL_PAD, '0')}`
    );
}

/**
 * The SQL expression rendering {@link perfFoodName}. The draw TABLES are passed as `text[]` parameters
 * rather than inlined, so this side indexes the very array {@link perfWords} indexes.
 *
 * @param kind - Which population the row belongs to.
 * @param column - The series column holding the index.
 * @param params - Placeholder numbers, per {@link PerfWordParams}.
 * @returns A SQL scalar expression producing the name.
 */
export function perfFoodNameSql(kind: PerfFoodKind, column: string, params: PerfWordParams): string {
    const { preparation, ingredient, cut, brand } = perfWordsSql(column, params);

    return (
        `${preparation} || ' ' || ${ingredient} || ' ' || ${cut} || ', ' || ${brand} || ' ' || ` +
        `'${PERF_KIND_LETTER[kind]}' || lpad(${column}::text, ${SERIAL_PAD}, '0')`
    );
}

/**
 * The golden `description` for a fixture food. Pure.
 *
 * Deliberately verbose and word-overlapping with the name: `food.search_vector` is generated over
 * `name || ' ' || description`, and `food_description_trgm_idx` is a GIN trigram index over the
 * description alone. A one-word description would leave both indexes far smaller (and every FTS/`ILIKE`
 * probe far cheaper) than the deployed store, i.e. it would make SC-007 pass for the wrong reason.
 *
 * @param index - Zero-based index within the population.
 * @returns The description.
 */
export function perfFoodDescription(index: number): string {
    const { preparation, ingredient, cut, brand } = perfWords(index);

    return (
        `${brand} brand ${ingredient} ${cut}, ${preparation}. Nutrition information for a ` +
        `${preparation} ${ingredient} product sold as ${cut}; includes macronutrients and household ` +
        `measures reported per 100 grams.`
    );
}

/** The SQL expression rendering {@link perfFoodDescription}; parameters as in {@link perfFoodNameSql}. */
export function perfFoodDescriptionSql(column: string, params: PerfWordParams): string {
    const { preparation, ingredient, cut, brand } = perfWordsSql(column, params);

    return (
        `${brand} || ' brand ' || ${ingredient} || ' ' || ${cut} || ', ' || ${preparation} || ` +
        `'. Nutrition information for a ' || ${preparation} || ' ' || ${ingredient} || ` +
        `' product sold as ' || ${cut} || '; includes macronutrients and household measures ` +
        `reported per 100 grams.'`
    );
}

/** `normalizeName` (src/foods/foodName.ts) applied to a fixture name. Pure. */
export function perfNormalizedName(kind: PerfFoodKind, index: number): string {
    return perfFoodName(kind, index).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The USDA crosswalk `external_key` for a fixture food (a plausible `fdcId`-shaped integer string). */
export function perfExternalKey(kind: PerfFoodKind, index: number): string {
    const offset = { resolved: 0, pending: 2_000_000, notFound: 4_000_000, queue: 6_000_000 }[kind];

    return String(900_000_000 + offset + index);
}

/** Width of the zero-padded numeric body of a fixture barcode (2-char prefix + 11 digits = GTIN-13). */
const BARCODE_PAD = 11;

/** The GTIN-13 barcode for a fixture food (digits only; the crosswalk probe target). */
export function perfBarcode(index: number): string {
    return `70${String(index).padStart(BARCODE_PAD, '0')}`;
}

/** The SQL expression rendering {@link perfBarcode}; the seeder asserts the two agree. */
export function perfBarcodeSql(column: string): string {
    return `'70' || lpad(${column}::text, ${BARCODE_PAD}, '0')`;
}

// ── Golden-record depth (nutrients + portions) ──────────────────────────────────────────────────
//
// `FoodDao.readGoldenRecord` is FIVE queries: the `food` row, then a parallel fan-out over
// `food_sources`, `food_nutrients ⋈ nutrient`, `food_portions` and `food_field_provenance`. A food with
// no nutrients and no portions would make four of those five return zero rows, and the SC-001 p95 would
// describe an empty aggregate rather than the golden record the API actually serves. So the read-target
// population carries a realistic USDA-shaped value set.

/** The nutrient dictionary the fixture seeds — the macro/micro set a USDA `Foundation` item carries. */
export const PERF_NUTRIENTS: readonly { readonly name: string; readonly unit: string; readonly code: string }[] = [
    { name: 'Energy', unit: 'kcal', code: 'ENERC_KCAL' },
    { name: 'Protein', unit: 'g', code: 'PROCNT' },
    { name: 'Total lipid (fat)', unit: 'g', code: 'FAT' },
    { name: 'Carbohydrate, by difference', unit: 'g', code: 'CHOCDF' },
    { name: 'Fiber, total dietary', unit: 'g', code: 'FIBTG' },
    { name: 'Sugars, total including NLEA', unit: 'g', code: 'SUGAR' },
    { name: 'Calcium, Ca', unit: 'mg', code: 'CA' },
    { name: 'Iron, Fe', unit: 'mg', code: 'FE' },
    { name: 'Magnesium, Mg', unit: 'mg', code: 'MG' },
    { name: 'Phosphorus, P', unit: 'mg', code: 'P' },
    { name: 'Potassium, K', unit: 'mg', code: 'K' },
    { name: 'Sodium, Na', unit: 'mg', code: 'NA' },
    { name: 'Zinc, Zn', unit: 'mg', code: 'ZN' },
    { name: 'Vitamin C, total ascorbic acid', unit: 'mg', code: 'VITC' },
    { name: 'Thiamin', unit: 'mg', code: 'THIA' },
    { name: 'Riboflavin', unit: 'mg', code: 'RIBF' },
    { name: 'Niacin', unit: 'mg', code: 'NIA' },
    { name: 'Vitamin B-6', unit: 'mg', code: 'VITB6' },
    { name: 'Vitamin A, RAE', unit: 'ug', code: 'VITA_RAE' },
    { name: 'Fatty acids, total saturated', unit: 'g', code: 'FASAT' },
];

/** Household-measure labels seeded per read target. */
export const PERF_PORTION_LABELS: readonly string[] = ['1 cup', '1 serving (85 g)', '1 tbsp'];

// ── Disposable-database guard ───────────────────────────────────────────────────────────────────

/**
 * Database names these scripts may write to. Port 5432 on a developer workstation holds LIVE local
 * databases (`kitchensink_recipes`, `kitchensink_identity`, `kitchensink_food`), and the seeder writes
 * tens of thousands of synthetic foods while the drain probe writes to `fetch_queue` — landing either in
 * a real database is not recoverable by deleting rows, because nothing distinguishes fixture data from
 * real data afterwards except this id scheme.
 */
const DISPOSABLE_DATABASES: readonly string[] = ['food_load', 'food_perf', 'food_it'];

/** Escape hatch for a differently-named disposable database (a CI service container, a scratch DB). */
const OVERRIDE_ENV = 'FOOD_PERF_ALLOW_NONSTANDARD_DB';

/**
 * Extract the database name from a Postgres connection string.
 *
 * @param connectionString - A `postgres://…/dbname` URL.
 * @returns The database name, or `undefined` when the URL has no path.
 */
function databaseNameOf(connectionString: string): string | undefined {
    try {
        const name = new URL(connectionString).pathname.replace(/^\//, '');

        return name.length > 0 ? name : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Resolve `DATABASE_URL` and refuse to proceed unless it names a disposable database.
 *
 * Exits the process non-zero with an actionable message rather than throwing, and NEVER falls back to a
 * default connection string — a script that guesses its target is exactly how a load fixture ends up in
 * a live database.
 *
 * @returns The validated connection string.
 * @sideEffect Reads `process.env` and may terminate the process.
 */
export function requireDisposableDatabaseUrl(): string {
    const connectionString = process.env['DATABASE_URL'];

    if (!connectionString) {
        console.error(
            'DATABASE_URL is required and has no default. Point it at a THROWAWAY database, e.g.\n' +
                '  DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_load',
        );
        process.exit(1);
    }

    const name = databaseNameOf(connectionString);

    if (name === undefined) {
        console.error(`DATABASE_URL ('${connectionString}') names no database — expected postgres://…/dbname.`);
        process.exit(1);
    }

    if (!DISPOSABLE_DATABASES.includes(name) && process.env[OVERRIDE_ENV] !== 'true') {
        console.error(
            `Refusing to seed the food performance fixture into database '${name}'.\n` +
                `This writes tens of thousands of synthetic foods and mutates fetch_queue; port 5432 on a ` +
                `workstation holds LIVE databases.\n` +
                `Use one of: ${DISPOSABLE_DATABASES.join(', ')} (create it with ` +
                `\`createdb food_load\`), or set ${OVERRIDE_ENV}=true if '${name}' really is disposable.`,
        );
        process.exit(1);
    }

    return connectionString;
}

// ── The emitted fixture file ────────────────────────────────────────────────────────────────────

/** Filename `preparePerfFixture.ts` writes and the k6 scripts `open()`. Gitignored (per-run derived). */
export const PERF_FIXTURE_FILENAME = 'perf-fixture.json';

/** The search probes emitted for `search.load.js`, one property per measured worst case. */
export interface PerfSearchProbes {
    /** One ingredient word: the broadest FTS match, and the ingredient axis's head term. */
    readonly broad: readonly string[];
    /** Preparation + ingredient: a two-lexeme AND. The head is still the INGREDIENT (English is head-final). */
    readonly phrase: readonly string[];
    /** Preparation + ingredient + cut: a narrow three-lexeme AND, heading on the CUT axis. */
    readonly narrow: readonly string[];
    /** A brand token: broad match on the independent brand axis, which is also its head. */
    readonly brand: readonly string[];
    /**
     * A curated-alias token (U2): matches ONLY through `aliases_search_vector`, because the alias
     * vocabulary shares no word with any name or description. Without this shape the alias branch's
     * RETRIEVAL is never measured — every other probe scans its GIN index and gets zero rows back.
     */
    readonly alias: readonly string[];
    /** Matches ZERO rows: the predicate is evaluated in full and cannot short-circuit on the limit. */
    readonly miss: readonly string[];
    // ⛔ There is deliberately NO two-character `short` probe (003-FR-010a, plan U37). A query below the
    // three-character minimum is answered without touching the database, so timing it would report the p95
    // of a short-circuit as evidence that SEARCH is fast — the "speed of doing no work" defect the
    // `expectHits` assertion in `search.load.js` exists to catch, arriving through the shape list instead.
    // `tests/load/__tests__/searchLoadShapes.test.ts` asserts it stays absent from both sides.
    /** A seeded GTIN-13: exercises the barcode crosswalk branch (`findFoodIdByBarcode`). */
    readonly barcode: readonly string[];
}

/** The shape of `perf-fixture.json`. */
export interface PerfFixtureFile {
    /** ISO-8601 timestamp of the seed run that produced this file. */
    readonly generatedAt: string;
    /** How many `RESOLVED` foods the store holds (the SC-007 population size). */
    readonly resolvedFoods: number;
    /** How many of those carry a full golden record (nutrients + portions + provenance). */
    readonly readTargets: number;
    /** `RESOLVED` ids with a full golden record — a read of one answers `200` (SC-001/SC-005). */
    readonly resolvedIds: readonly string[];
    /** `PENDING` ids — a read answers `202`, i.e. NOT served from the local store (SC-004). */
    readonly pendingIds: readonly string[];
    /** Tombstoned `NOT_FOUND` ids — a read answers `404`, also not served (SC-004). */
    readonly notFoundIds: readonly string[];
    /** The SC-007 search probes. */
    readonly search: PerfSearchProbes;
}

/**
 * Which head axis each shape's probes draw their HEAD TERM from — `null` where the head names nothing the
 * corpus carries, so no head-term retrieval happens at all.
 *
 * `describeRankingQuery` takes the LAST token as the head (a typed query is an English noun phrase, which
 * is head-final), which is why `phrase` heads on its ingredient and `narrow` on its cut. Stated once, as a
 * total record over the shape set, so adding a shape without saying which axis it heads on is a COMPILE
 * error rather than a silently unmeasured selectivity regime.
 */
export const SHAPE_HEAD_AXIS = {
    broad: 'ingredient',
    phrase: 'ingredient',
    narrow: 'cut',
    brand: 'brand',
    alias: 'brand',
    miss: null,
    barcode: null,
} as const satisfies Readonly<Record<keyof PerfSearchProbes, keyof typeof HEAD_TERM_AXES | null>>;

/**
 * The step a probe set walks its vocabulary with.
 *
 * ⚠️ Not 1. The head-bearing vocabularies are ORDERED BY SELECTIVITY, so consecutive words sit in the same
 * regime and a small probe count would sample only the broadest end of the ladder — every probe expensive,
 * none typical, which is the mirror of the uniform fixture U30 replaced. 23 is prime and therefore coprime
 * to every list length here (36, 13, 7), so the walk is a full permutation of each; low-discrepancy, so
 * even three probes span all three regimes. `perfFixtureDistribution.test.ts` asserts exactly that.
 */
const PROBE_STRIDE = 23;

/**
 * Build the search probe set for a seeded population. Pure — the words come from the vocabulary above,
 * so a probe can never name a term the seed does not produce.
 *
 * @param count - How many probes of each kind to emit (rotated by the scripts).
 * @returns The probe set.
 */
export function buildSearchProbes(count: number): PerfSearchProbes {
    const at = <T>(list: readonly T[], index: number): T => list[(index * PROBE_STRIDE) % list.length]!;
    const range = Array.from({ length: count }, (_unused, index) => index);

    return {
        broad: range.map((index) => at(INGREDIENTS, index)),
        phrase: range.map((index) => `${at(PREPARATIONS, index)} ${at(INGREDIENTS, index)}`),
        narrow: range.map((index) => `${at(PREPARATIONS, index)} ${at(INGREDIENTS, index)} ${at(CUTS, index)}`),
        brand: range.map((index) => at(BRANDS, index)),
        // Two lexemes, both of which only ever appear in `aliases`: the alias term itself and the brand
        // token that is glued to it there. `<term> <brand>` is a two-lexeme AND that no name or
        // description can satisfy, so a hit proves the alias vector answered.
        alias: range.map((index) => `${at(ALIAS_TERMS, index)} ${at(BRANDS, index)}`),
        // Nonsense tokens: no lexeme, no trigram and no substring in any seeded name or description, so
        // every branch of the search predicate runs to completion and returns nothing.
        miss: range.map((index) => `zqxjkvwf${index}`),
        barcode: range.map((index) => perfBarcode(index)),
    };
}
