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

// ── Name vocabulary ─────────────────────────────────────────────────────────────────────────────
//
// A golden `name` is `<preparation> <ingredient> <cut>, <brand> <serial>`, and the description repeats
// the same words in prose. The three word lists are SIZED to give the SC-007 search probes KNOWN
// selectivity against the seeded population, which is what makes a search measurement interpretable
// rather than a number: with `n` foods, a query for one ingredient matches ~n/INGREDIENTS.length rows,
// a preparation+ingredient pair ~n/(PREPARATIONS.length * INGREDIENTS.length), and so on. All three
// counts are coprime-ish and the index is threaded through every position, so the cross product spreads
// evenly instead of clustering.

/** Leading preparation word (7). */
export const PREPARATIONS = ['raw', 'cooked', 'roasted', 'canned', 'frozen', 'dried', 'grilled'] as const;

/** Ingredient head noun (23) — the single-word search probe matches ~n/23 rows. */
export const INGREDIENTS = [
    'chicken',
    'beef',
    'pork',
    'salmon',
    'tuna',
    'broccoli',
    'spinach',
    'carrot',
    'potato',
    'rice',
    'quinoa',
    'lentil',
    'almond',
    'walnut',
    'yogurt',
    'cheddar',
    'mozzarella',
    'apple',
    'banana',
    'blueberry',
    'oat',
    'barley',
    'chickpea',
] as const;

/** Cut / form qualifier (11). */
export const CUTS = [
    'breast',
    'thigh',
    'fillet',
    'whole',
    'sliced',
    'diced',
    'puree',
    'flour',
    'flakes',
    'shredded',
    'ground',
] as const;

/** Brand token (17) — a second broad-match axis independent of the ingredient axis. */
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
] as const;

/** Width of the zero-padded serial embedded in a name (its uniqueness discriminator). */
const SERIAL_PAD = 6;

/**
 * The golden `name` for a fixture food. Pure.
 *
 * The trailing zero-padded serial is what makes `normalized_name` unique across 50,000 rows — the
 * vocabulary's cross product is only 7 x 23 x 11 x 17 = 29,491, so a purely lexical name would collide
 * against `food_normalized_name_unique` and the seed would silently insert fewer rows than requested.
 *
 * @param kind - Which population the row belongs to (kept in the name so a stray row is traceable).
 * @param index - Zero-based index within that population.
 * @returns The display name.
 */
export function perfFoodName(kind: PerfFoodKind, index: number): string {
    const preparation = PREPARATIONS[index % PREPARATIONS.length];
    const ingredient = INGREDIENTS[index % INGREDIENTS.length];
    const cut = CUTS[index % CUTS.length];
    const brand = BRANDS[index % BRANDS.length];

    return (
        `${preparation} ${ingredient} ${cut}, ${brand} ` +
        `${PERF_KIND_LETTER[kind]}${String(index).padStart(SERIAL_PAD, '0')}`
    );
}

/**
 * The SQL expression rendering {@link perfFoodName}. The vocabulary itself is passed as `text[]`
 * parameters rather than inlined, so the word lists above stay the single source of truth.
 *
 * @param kind - Which population the row belongs to.
 * @param column - The series column holding the index.
 * @param params - 1-based placeholder numbers for the preparation, ingredient, cut and brand arrays.
 * @returns A SQL scalar expression producing the name.
 */
export function perfFoodNameSql(
    kind: PerfFoodKind,
    column: string,
    params: { preparations: number; ingredients: number; cuts: number; brands: number },
): string {
    const pick = (param: number, length: number): string => `($${param}::text[])[(${column} % ${length}) + 1]`;

    return (
        `${pick(params.preparations, PREPARATIONS.length)} || ' ' || ` +
        `${pick(params.ingredients, INGREDIENTS.length)} || ' ' || ` +
        `${pick(params.cuts, CUTS.length)} || ', ' || ` +
        `${pick(params.brands, BRANDS.length)} || ' ' || ` +
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
    const preparation = PREPARATIONS[index % PREPARATIONS.length];
    const ingredient = INGREDIENTS[index % INGREDIENTS.length];
    const cut = CUTS[index % CUTS.length];
    const brand = BRANDS[index % BRANDS.length];

    return (
        `${brand} brand ${ingredient} ${cut}, ${preparation}. Nutrition information for a ` +
        `${preparation} ${ingredient} product sold as ${cut}; includes macronutrients and household ` +
        `measures reported per 100 grams.`
    );
}

/** The SQL expression rendering {@link perfFoodDescription}; parameters as in {@link perfFoodNameSql}. */
export function perfFoodDescriptionSql(
    column: string,
    params: { preparations: number; ingredients: number; cuts: number; brands: number },
): string {
    const pick = (param: number, length: number): string => `($${param}::text[])[(${column} % ${length}) + 1]`;
    const preparation = pick(params.preparations, PREPARATIONS.length);
    const ingredient = pick(params.ingredients, INGREDIENTS.length);
    const cut = pick(params.cuts, CUTS.length);
    const brand = pick(params.brands, BRANDS.length);

    return (
        `${brand} || ' brand ' || ${ingredient} || ' ' || ${cut} || ', ' || ${preparation} || ` +
        `'. Nutrition information for a ' || ${preparation} || ' ' || ${ingredient} || ` +
        `' product sold as ' || ${cut} || '; includes macronutrients and household measures ` +
        `reported per 100 grams.'`
    );
}

/** `normalizeName` (src/foods/merge/mergeEngine.ts) applied to a fixture name. Pure. */
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
    /** One ingredient word: the broadest FTS match (~`resolvedFoods / 23` rows must all be ranked). */
    readonly broad: readonly string[];
    /** Preparation + ingredient: a two-lexeme AND (~`resolvedFoods / 161` rows). */
    readonly phrase: readonly string[];
    /** Preparation + ingredient + cut: a narrow three-lexeme AND. */
    readonly narrow: readonly string[];
    /** A brand token: broad match on the independent brand axis. */
    readonly brand: readonly string[];
    /** Matches ZERO rows: the predicate is evaluated in full and cannot short-circuit on the limit. */
    readonly miss: readonly string[];
    /** A 2-character prefix: too short for trigram extraction, so `ILIKE '%..%'` cannot use the GIN index. */
    readonly short: readonly string[];
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
 * Build the search probe set for a seeded population. Pure — the words come from the vocabulary above,
 * so a probe can never name a term the seed does not produce.
 *
 * @param count - How many probes of each kind to emit (rotated by the scripts).
 * @returns The probe set.
 */
export function buildSearchProbes(count: number): PerfSearchProbes {
    const at = <T>(list: readonly T[], index: number): T => list[index % list.length]!;
    const range = Array.from({ length: count }, (_unused, index) => index);

    return {
        broad: range.map((index) => at(INGREDIENTS, index)),
        phrase: range.map((index) => `${at(PREPARATIONS, index)} ${at(INGREDIENTS, index)}`),
        narrow: range.map((index) => `${at(PREPARATIONS, index)} ${at(INGREDIENTS, index)} ${at(CUTS, index)}`),
        brand: range.map((index) => at(BRANDS, index)),
        // Nonsense tokens: no lexeme, no trigram and no substring in any seeded name or description, so
        // every branch of the search predicate runs to completion and returns nothing.
        miss: range.map((index) => `zqxjkvwf${index}`),
        // Two characters: `show_trgm('ch')` yields only padded partial trigrams, so `ILIKE '%ch%'` is not
        // index-supported. This is the query shape a real user types after two keystrokes.
        short: range.map((index) => at(INGREDIENTS, index).slice(0, 2)),
        barcode: range.map((index) => perfBarcode(index)),
    };
}
