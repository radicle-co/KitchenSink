/**
 * The ONE definition of the deferred-nutrition load fixture: the id scheme, the two ingredient-overlap
 * shapes, the wave arithmetic and the disposable-database guard, shared by
 * `prepareNutritionFanoutFixture.ts` (which seeds Postgres and emits the JSON) and its integration test.
 * `nutritionBatch.load.js` never re-derives any of it — it `open()`s the emitted JSON, so a fixture rule
 * lives here exactly once. Mirrors food's `perfFixture.ts`.
 *
 * TypeScript run under `tsx`, deliberately NOT in `lib/` — `lib/*.js` is goja-only and may import nothing
 * but k6 built-ins.
 *
 * ## What this fixture exists to make measurable (ADR-0021, "Residual risk")
 *
 * `POST /api/v1/recipes/nutrition-batch` costs one indexed read plus a FAN-OUT: the distinct foods its
 * recipes name are split at food's 100-id cap and issued in bounded waves of six, so
 *
 *     waves = ceil(ceil(distinctFoods / MAX_IDS_PER_REQUEST) / MAX_CONCURRENT_CHUNKS)
 *
 * and the tail is dominated by that wave count. The superseded k6 scenario padded a short seeded list to
 * the 500-id cap with ids that resolve to NO recipe, so distinct-food count stayed at a handful and the
 * fan-out stayed at ONE call however wide the request got. It measured request width and would have gone
 * green on precisely the case that cannot fail.
 *
 * So the fixture seeds TWO sets of the SAME size, differing only in ingredient overlap:
 *
 * | Set       | Recipes | Lines each | Distinct foods | Chunks | Waves | What it is                       |
 * | --------- | ------- | ---------- | -------------- | ------ | ----- | -------------------------------- |
 * | `fanout`  | 500     | 10         | 5,000          | 50     | 9     | zero overlap — the worst case    |
 * | `overlap` | 500     | 10         | 12             | 1      | 1     | a shared pantry — the best case  |
 *
 * Neither is "the" real number: a genuine 500-recipe list shares staples but is not built from twelve of
 * them, so the truth is between the two, and the DIFFERENCE between them is the cost of fan-out with
 * everything else held constant.
 */

// ── The gateway constants this fixture's arithmetic mirrors ─────────────────────────────────────

/**
 * Food's per-request id cap, mirroring `MAX_IDS_PER_REQUEST` in `src/ingredients/foodNutrition.gateway.ts`
 * (and `MAX_NUTRITION_IDS` in `@kitchensink/schema-food`, which is the authority both restate).
 *
 * A restatement rather than an import because the k6 side of this fixture cannot import TypeScript at all;
 * the seeder asserts the emitted numbers against the DATABASE it just wrote, so a drift shows up as a wave
 * count that disagrees with reality rather than as a silently wrong constant.
 */
export const FOOD_CHUNK_SIZE = 100;

/** How many chunks the gateway keeps in flight — mirrors `MAX_CONCURRENT_CHUNKS` in the same module. */
export const MAX_CONCURRENT_CHUNKS = 6;

// ── The fixture's shape ─────────────────────────────────────────────────────────────────────────

/**
 * Recipes per set — the published `MAX_NUTRITION_RECIPE_IDS` cap (REQ-IF-008), because the cap is exactly
 * the claim under test: a client told to chunk at 500 must get an answer at 500.
 */
export const FANOUT_RECIPE_COUNT = 500;

/**
 * Lines per fixture recipe. Ten is the density that turns the 500-recipe cap into ~5,000 distinct foods —
 * 50 chunks, 9 waves — and it is an ordinary recipe length rather than a number chosen to break the budget.
 */
export const FANOUT_LINES_PER_RECIPE = 10;

/**
 * Distinct ingredients the `overlap` set draws its lines from — a shared pantry.
 *
 * Twelve, not ten, so consecutive recipes rotate through a different subset and the set is not 500 copies
 * of one recipe (which would be a fixture with a single row's worth of cardinality).
 */
export const OVERLAP_STAPLE_COUNT = 12;

/**
 * A realistic card-grid page, in recipes — what a list/search surface actually asks about in one call.
 * Drawn from the `overlap` set because a page of one user's recipes does share staples.
 */
export const NUTRITION_PAGE_RECIPES = 20;

/**
 * A 30-day plan at four slots a day — the shape REQ-NF-006's 500 ms p95 is stated over. Drawn from the
 * `fanout` set, so it is the worst-case overlap at the density the requirement actually names.
 */
export const PLAN_RECIPES = 120;

/** Grams per fixture line. A mass unit converts without a household portion, so a resolved food always
 * contributes — `unaccounted{no_nutrient_data}` would be a 200 that proves the food data never applied. */
export const FIXTURE_LINE_QUANTITY_G = 50;

/** The fixture line's unit. MUST stay a `MASS_UNIT_TO_GRAMS` key (asserted by the integration test). */
export const FIXTURE_LINE_UNIT = 'g';

/** Owner of every fixture recipe — a synthetic, non-existent app-user ULID. */
export const FIXTURE_OWNER_ID = '01JLOADFANOUT0000000OWNER1';

/** Servings every fixture recipe divides by; fixed so the per-serving figure is reproducible. */
export const FIXTURE_SERVINGS = 4;

// ── Deterministic ids ───────────────────────────────────────────────────────────────────────────
//
// Every id is a function of its kind + index, so a re-run seeds the same world, the seed is idempotent,
// and the bulk SQL can render an id inline (`'…-a' || lpad(i::text, 11, '0')`) instead of shipping a
// 5,000-element array. The seeder asserts the SQL rendering and the functions below agree.
//
// The recipe/ingredient ids are UUIDs (`uuid` columns, and `recipeNutritionRequestSchema` validates each
// with `z.uuid()`), minted in the `4`/`8` version-variant shape the rest of this suite uses; a one-letter
// discriminator keeps the four id spaces textually distinct in a failure dump. The food id is OPAQUE text
// on this side of the boundary (`ingredients.food_id` is a cross-service reference, never an FK), and is
// minted ULID-shaped so it is indistinguishable from a real one to every layer that handles it.

/** A UUID in one of the fixture's id spaces. Pure. */
function fixtureUuid(space: string, index: number): string {
    return `00000000-0000-4000-8000-${space}${String(index).padStart(11, '0')}`;
}

/**
 * An id in a space this fixture NEVER seeds — a recipe that provably does not exist.
 *
 * ⛔ Minted from `fixtureUuid` rather than hand-rolled at the call site. The padding test previously built
 * its own `00000000-0000-4000-8000-{12 digits}` ids, a scheme parallel to this one, and any row that any
 * OTHER spec seeds in that range makes "padding adds no distinct food" false — which is exactly how it
 * failed in CI, where the whole integration tier shares one database, while passing locally against a
 * private one. Space `e` is owned by this fixture and written by nothing, so an id from it cannot resolve.
 *
 * @param index - The nth unresolvable id.
 * @returns A well-formed UUID that matches no recipe.
 */
export function unresolvableRecipeId(index: number): string {
    return fixtureUuid('e', index);
}

/** The `index`-th zero-overlap recipe. Pure. */
export function fanoutRecipeId(index: number): string {
    return fixtureUuid('a', index);
}

/** The `index`-th shared-pantry recipe. Pure. */
export function overlapRecipeId(index: number): string {
    return fixtureUuid('b', index);
}

/** The `index`-th catalog ingredient used by exactly one `fanout` recipe. Pure. */
export function fanoutIngredientId(index: number): string {
    return fixtureUuid('c', index);
}

/** The `index`-th staple, shared by every `overlap` recipe. Pure. */
export function stapleIngredientId(index: number): string {
    return fixtureUuid('d', index);
}

/**
 * The opaque food id an ingredient references. Pure.
 *
 * 26 characters, `01JFAN0000` timestamp part + a kind letter + a zero-padded decimal index — all Crockford
 * base32, so it is a well-formed ULID and the decimal digits let the same id be rendered by `lpad` in SQL.
 */
function fixtureFoodId(letter: string, index: number): string {
    return `01JFAN0000${letter}${String(index).padStart(15, '0')}`;
}

/** The food behind {@link fanoutIngredientId}. Pure. */
export function fanoutFoodId(index: number): string {
    return fixtureFoodId('F', index);
}

/** The food behind {@link stapleIngredientId}. Pure. */
export function stapleFoodId(index: number): string {
    return fixtureFoodId('S', index);
}

/**
 * Which ingredient index a given `overlap` line uses. Pure.
 *
 * Rotated by the recipe index so the 500 recipes are not 500 identical rows while still drawing from the
 * same small pantry — the point of the set is a low distinct-FOOD count, not identical recipes.
 */
export function overlapIngredientIndex(recipeIndex: number, lineIndex: number): number {
    return (recipeIndex + lineIndex) % OVERLAP_STAPLE_COUNT;
}

// ── The wave arithmetic (ADR-0021 §4) ───────────────────────────────────────────────────────────

/** Food requests a batch of `distinctFoods` is split into. Pure. */
export function chunksFor(distinctFoods: number): number {
    return Math.ceil(distinctFoods / FOOD_CHUNK_SIZE);
}

/**
 * Sequential round trips to food a batch of `distinctFoods` costs. Pure.
 *
 * This is the number the endpoint's tail is dominated by: chunks inside one wave overlap, waves do not.
 */
export function wavesFor(distinctFoods: number): number {
    return Math.ceil(chunksFor(distinctFoods) / MAX_CONCURRENT_CHUNKS);
}

// ── The emitted fixture file ────────────────────────────────────────────────────────────────────

/**
 * Filename the seeder writes and `nutritionBatch.load.js` `open()`s.
 *
 * Named for the shape `.gitignore` already protects — the `perf-fixture.json` entry under any service's
 * `tests/load` directory:
 * it is a per-run derived blob, not source — committing one would put one run's row counts in the tree
 * where the next reader mistakes them for the agreed fixture. The RULES that generate it are the committed
 * artifact, and they are this file.
 */
export const NUTRITION_FIXTURE_FILENAME = 'perf-fixture.json';

/** One seeded set: the recipe ids to ask about, and the fan-out the database says they cost. */
export interface NutritionFixtureSet {
    /** The recipe ids, in mint order. */
    readonly recipeIds: readonly string[];
    /** Distinct `ingredients.food_id` values reachable from those recipes — MEASURED, not derived. */
    readonly distinctFoodCount: number;
    /** {@link chunksFor} of the measured count. */
    readonly expectedChunks: number;
    /** {@link wavesFor} of the measured count — the sequential food round trips one request costs. */
    readonly expectedWaves: number;
}

/** What `prepareNutritionFanoutFixture.ts` emits and the k6 script reads. */
export interface NutritionFanoutFixture {
    /** Zero ingredient overlap: distinct foods scale with recipe count. The worst case. */
    readonly fanout: NutritionFixtureSet;
    /** A twelve-item shared pantry at the same recipe count. The best case. */
    readonly overlap: NutritionFixtureSet;
    /** {@link NUTRITION_PAGE_RECIPES} ids from `overlap` — the request a card grid actually sends. */
    readonly page: NutritionFixtureSet;
    /** {@link PLAN_RECIPES} ids from `fanout` — a 30-day × 4-slot plan, the shape REQ-NF-006 names. */
    readonly plan: NutritionFixtureSet;
}

// ── Disposable-database guard ───────────────────────────────────────────────────────────────────

/**
 * Database names the seeder may write to.
 *
 * Port 5432 on a developer workstation holds LIVE local databases (`kitchensink_recipes`), and this seeder
 * writes 1,000 recipes, 5,012 ingredients and 10,000 line rows. Landing that in a real database is not
 * recoverable by deleting rows, because afterwards nothing distinguishes fixture data from real data
 * except this file's id scheme.
 */
const DISPOSABLE_DATABASES: readonly string[] = ['recipe_load', 'recipes_load', 'recipe_perf'];

/** Escape hatch for a differently-named disposable database (a CI service container, a scratch DB). */
const OVERRIDE_ENV = 'RECIPE_PERF_ALLOW_NONSTANDARD_DB';

/** The database a Postgres connection string names, or `undefined` when it names none. Pure. */
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
 * Exits non-zero with an actionable message rather than throwing, and NEVER falls back to a default
 * connection string — a script that guesses its target is how a load fixture ends up in a live database.
 *
 * @returns The validated connection string.
 * @sideEffect Reads `process.env` and may terminate the process.
 */
export function requireDisposableDatabaseUrl(): string {
    const connectionString = process.env['DATABASE_URL'];

    if (!connectionString) {
        console.error(
            'DATABASE_URL is required and has no default. Point it at a THROWAWAY database, e.g.\n' +
                '  DATABASE_URL=postgres://postgres:postgres@localhost:5432/recipe_load',
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
            `Refusing to seed the nutrition fan-out fixture into database '${name}'.\n` +
                'It writes 1,000 recipes, 5,012 ingredients and 10,000 line rows; port 5432 on a workstation ' +
                'holds LIVE databases.\n' +
                `Use one of: ${DISPOSABLE_DATABASES.join(', ')} (create it with \`createdb recipe_load\`), or ` +
                `set ${OVERRIDE_ENV}=true if '${name}' really is disposable.`,
        );
        process.exit(1);
    }

    return connectionString;
}
