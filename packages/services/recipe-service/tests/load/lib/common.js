// Shared configuration + payload helpers for the recipe-service k6 load suite.
//
// These modules are ES-module JavaScript executed by the **k6 binary** (`k6 run ...`) — they are NOT
// part of the vitest suite and must only import from k6's built-in modules (`k6`, `k6/http`,
// `k6/metrics`). All target/credential configuration is read from the environment via k6's `__ENV`.

// Base URL of the recipe-service under test (Nest app / ALB host). Defaults to the local dev port.
export const BASE_URL = (__ENV['RECIPE_API_BASE_URL'] || 'http://localhost:3000').replace(/\/+$/, '');

// A pre-minted Clerk session token (Bearer). Every route except /health is auth-protected, so a real
// run MUST supply this; without it the service answers 401 and the failure-rate threshold trips.
export const TOKEN = __ENV['RECIPE_LOAD_TEST_TOKEN'] || '';

// --- Performance targets (SC-009 / FR-007b-i) ---------------------------------------------------
// p95 <= 500ms for recipe read/list/create and for save even while the S3 archive is queued.
export const SC009_P95_MS = Number(__ENV['RECIPE_SAVE_P95_MS'] || 500);
// Search must return in < 2s.
export const SEARCH_P95_MS = Number(__ENV['RECIPE_SEARCH_P95_MS'] || 2000);
// W8-a.7 — the S3 version-archive fallback GET. Slower than a plain DB row read (SC009_P95_MS's 500ms)
// because it costs a network round trip to S3 plus a JSON parse instead of a single indexed Postgres
// lookup, but it is a single-object GetObject (not a query), so it stays well under search's 2s budget
// (a full-text query). 1s gives headroom above the DB baseline while still catching a genuinely slow
// archive read (e.g. S3 throttling, a cold connection).
export const VERSION_ARCHIVE_READ_P95_MS = Number(__ENV['RECIPE_VERSION_ARCHIVE_READ_P95_MS'] || 1000);
// Search Stage 2 — the blended ingredient typeahead (GET /api/v1/ingredients/suggest). Budgeted as a DEGRADATION
// bound rather than a query cost: the route issues the recipe-local read and the food-catalog read
// concurrently, and the catalog read is capped by the short typeahead timeout (600ms default,
// FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS) after which it falls back to local-only. So the worst healthy case is
// roughly "local trgm/FTS read + that timeout", and 1.5s leaves headroom for a cold connection while still
// catching the two regressions that matter: the timeout no longer being enforced (which would drift toward the
// food client's 8s default) or the two reads collapsing into sequential awaits. Deliberately TIGHTER than
// search's 2s — a per-keystroke path cannot be given a full-text query's budget.
export const SUGGEST_P95_MS = Number(__ENV['RECIPE_SUGGEST_P95_MS'] || 1500);

// The deferred nutrition batch (POST /api/v1/recipes/nutrition-batch). Budgeted as a FAN-OUT bound rather
// than a query cost: the endpoint is one indexed read plus one batched food call, and the food half splits
// at food's 100-id per-request cap into SEQUENTIAL sub-requests — so the tail grows with the number of
// DISTINCT foods a batch names, not with the number of recipes. 1.5s is deliberately tighter than search's
// 2s (this is a card-grid enrichment, not a full-text query) and looser than the 500ms single-recipe read
// (it legitimately crosses a service boundary). It is the number that decides whether the published
// MAX_NUTRITION_RECIPE_IDS cap is a promise the service can keep.
export const NUTRITION_BATCH_P95_MS = Number(__ENV['RECIPE_NUTRITION_BATCH_P95_MS'] || 1500);

// The published per-request recipe-id cap (mirrors MAX_NUTRITION_RECIPE_IDS in the authored contract,
// `src/recipes/recipes.schema.ts`). k6 scripts cannot import TypeScript, so this is a restatement — the
// cap scenario asserts the service ACCEPTS exactly this many ids, which is what makes the restatement
// self-checking rather than a second source of truth that can drift silently.
export const MAX_NUTRITION_RECIPE_IDS = Number(__ENV['RECIPE_MAX_NUTRITION_IDS'] || 500);

// A realistic card-grid page — what a list/search surface actually asks about in one call.
export const NUTRITION_PAGE_SIZE = Number(__ENV['RECIPE_NUTRITION_PAGE_SIZE'] || 20);

// --- Load shape ---------------------------------------------------------------------------------
// SC-009's headline target is p95 <= 500ms at 10k concurrent. A single k6 runner cannot honestly
// generate 10k VUs, so the peak is env-driven: CI runs a safe smoke value and the true SC-009
// validation supplies a high RECIPE_LOAD_PEAK_VUS from a distributed / k6 Cloud execution.
export const PEAK_VUS = Number(__ENV['RECIPE_LOAD_PEAK_VUS'] || 50);
export const RAMP_UP = __ENV['RECIPE_LOAD_RAMP_UP'] || '30s';
export const HOLD = __ENV['RECIPE_LOAD_HOLD'] || '1m';
export const RAMP_DOWN = __ENV['RECIPE_LOAD_RAMP_DOWN'] || '15s';

// A ramping-vus stage set to the given peak. Shared by every scenario so load shape stays uniform.
export function rampStages(peak) {
    return [
        { duration: RAMP_UP, target: peak },
        { duration: HOLD, target: peak },
        { duration: RAMP_DOWN, target: 0 },
    ];
}

// Read-only headers (Bearer + Accept).
export function authHeaders(extra) {
    const headers = { Accept: 'application/json' };

    if (TOKEN) {
        headers['Authorization'] = `Bearer ${TOKEN}`;
    }

    return Object.assign(headers, extra || {});
}

// Write headers (adds JSON content-type).
export function jsonHeaders() {
    return authHeaders({ 'Content-Type': 'application/json' });
}

// RFC-4122 v4 UUID. Math.random is fine for load-test ingredient ids (not a security context).
export function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;

        return v.toString(16);
    });
}

// Seeded baseline ingredient ids (must match tests/globalSetup.ts SEED_INGREDIENTS + the k6 CI job's
// seed step). Since T043b, recipe create validates every line's `ingredientId` against the catalog, so a
// random uuid would 400 (UNKNOWN_INGREDIENT) and trip the failure-rate threshold. Load payloads must
// reference ids that actually exist.
export const SEED_INGREDIENT_FLOUR = '00000000-0000-4000-8000-0000000000aa';
export const SEED_INGREDIENT_SUGAR = '00000000-0000-4000-8000-0000000000bb';

// The fixture recipe `tests/load/prepareVersionArchiveFixture.ts` seeds (must match its
// ARCHIVE_FIXTURE_RECIPE_ID): version 1 exists ONLY in the S3 archive (its `recipe_versions` row is
// deliberately absent), so a GET of it always exercises the W8-a.7 transparent S3 fallback.
export const ARCHIVE_FIXTURE_RECIPE_ID =
    __ENV['RECIPE_ARCHIVE_FIXTURE_RECIPE_ID'] || '00000000-0000-4000-8000-0000000000f1';

// A valid CreateRecipeRequest body (matches specs/001-commise-recipe-app/contracts/api.openapi.yaml).
export function makeRecipePayload(label) {
    return {
        title: `Load Test Recipe ${label}`,
        description: 'Generated by the recipe-service k6 load suite.',
        cuisine: 'italian',
        visibility: 'public',
        ingredients: [
            { ingredientId: SEED_INGREDIENT_FLOUR, name: 'flour', quantity: 2, unit: 'cups' },
            { ingredientId: SEED_INGREDIENT_SUGAR, name: 'sugar', quantity: 1, unit: 'cup' },
        ],
        steps: [
            { instruction: 'Mix the dry ingredients.' },
            { instruction: 'Add the water and knead into a dough.', timerSeconds: 300 },
        ],
        servings: 4,
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 45,
        tags: ['load-test'],
        dietaryFlags: ['vegetarian'],
    };
}
