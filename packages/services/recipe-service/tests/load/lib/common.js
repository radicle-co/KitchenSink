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

// --- The deferred nutrition batch (POST /api/v1/recipes/nutrition-batch) -------------------------
//
// THE DERIVATION. This endpoint's cost is a FAN-OUT, not a query: one indexed read of the named recipes'
// lines, then the DISTINCT foods those lines reference, split at food's 100-id cap and issued in bounded
// waves of six (`MAX_CONCURRENT_CHUNKS`, ADR-0021 §4). So
//
//     waves = ceil(ceil(distinctFoods / 100) / 6)      cost ≈ readCost + waves × foodLatency
//
// and the tail is dominated by the WAVE COUNT — which grows with distinct FOODS, not with recipe ids. At
// the 500-recipe cap that is 1 wave for a shared pantry and 9 for a zero-overlap list: the same request
// width, an order of magnitude apart in cost. `nutritionBatch.load.js` measures both ends.
//
// 1.5s is deliberately tighter than search's 2s (this is a card-grid enrichment, not a full-text query)
// and looser than the 500ms single-recipe read (it legitimately crosses a service boundary). It is the
// number that decides whether the published MAX_NUTRITION_RECIPE_IDS cap is a promise the service can keep.
//
// MEASURED — 2026-08-17 (the way SEARCH_P95_MS records its own history; a budget with no measurement
// beside it is a preference). Recipe-service Docker image + Postgres 16 (Docker) + `foodNutritionStub.mjs`
// standing in for food at a STATED per-chunk latency, WSL2 workstation, k6 v0.54.0, 15s ramp + 30s hold +
// 5s down per scenario, scenarios run sequentially:
//
//   | scenario    | VUs | ids | distinct foods | waves | p95      | p99      |
//   | ----------- | --- | --- | -------------- | ----- | -------- | -------- |
//   | degraded    |   5 | 500 | food is down   |     0 |  73.22ms |  77.52ms |
//   | page        |  50 |  20 |             12 |     1 |  32.74ms |  34.00ms |
//   | plan        |  10 | 120 |          1,200 |     2 |  75.90ms |  91.76ms |
//   | cap-overlap |   5 | 500 |             12 |     1 |  70.96ms |  74.87ms |
//   | cap-fanout  |   5 | 500 |          5,000 |     9 | 411.08ms | 447.45ms |
//
// THE SLOPE IS THE FAN-OUT, and it was measured rather than assumed: sweeping the stub delay L over
// 5/10/25/50ms moved the single-client cap-fanout median 131.6 / 173.9 / 309.3 / 538.2ms — a slope of
// 9.04 ms per ms, against 9 predicted waves. The other two shapes came out at 2.03 (plan, 2 waves) and
// 0.99 (cap-overlap, 1 wave). So the model is `≈ 87 + 9L` at the cap, and the 500-id cap crosses 500ms at
// L ≈ 46ms and this 1500ms budget at L ≈ 157ms. Food budgets a single golden-record read at 50ms p95
// (SC-001) and answers `?ids=` from a 3-query view, so the cap sits ON the 500ms line and comfortably
// inside this one. Recorded in ADR-0021's residual-risk note.
//
// The superseded `capBatch` scenario measured 34.2ms for the same "500 ids" — one food call, 20 resolved
// recipes — because it padded with ids that resolve to nothing. Same request width, 9.3× off the cost.
//
// MEASURED IN CI — 2026-08-18, `_ci-heavy.yml` "Load test (recipe — k6)" on `ubuntu-latest` (2 vCPU),
// SAME script, SAME `FOOD_STUB_DELAY_MS=25`, same 5 sequential scenarios. This is the run the budget is
// actually held against, and it is NOT a rounding error away from the workstation table above:
//
//   | scenario    | ids | distinct foods | waves | p95      | p99      | vs workstation |
//   | ----------- | --- | -------------- | ----- | -------- | -------- | -------------- |
//   | degraded    | 500 | food is down   |     0 | 149.04ms | 175.04ms |          2.0×  |
//   | page        |  20 |             12 |     1 |  44.50ms |  50.97ms |          1.4×  |
//   | plan        | 120 |          1,200 |     2 | 119.40ms | 130.24ms |          1.6×  |
//   | cap-overlap | 500 |             12 |     1 | 255.51ms | 268.36ms |          3.6×  |
//   | cap-fanout  | 500 |          5,000 |     9 | 857.00ms | 860.92ms |          2.1×  |
//
// ⛔ THE `≈ 87 + 9L` MODEL ABOVE IS WORKSTATION-SPECIFIC — do not carry it to another host. Subtract the
// stub's own cost (waves × 25ms) and what remains is recipe-side: cap-overlap 46ms → 231ms, cap-fanout
// 186ms → 632ms. On 2 vCPUs the batch is dominated by the recipe's OWN work — chunking 5,000 ids into 50
// requests and folding 5,000 entries into 500 per-recipe sums — not by waiting on food. That inverts the
// slope: the workstation says "the fan-out is the cost", CI says "the aggregation is the cost". Both are
// true of their host, which is why the threshold is a BOUND and not a derived number.
//
// Headroom against the 1500ms budget is therefore 1.75×, not the 3.6× the workstation implied. That is
// still a pass with room, but it is the figure to re-check when the cap, the chunk size, or the runner
// class changes — and the reason to re-run rather than re-derive.
//
// ⛔ BOTH tables are against a STUBBED food origin: they bound the recipe-side STRUCTURE (how many
// sequential round trips one batch costs, and what folding the result costs), not production latency. A
// run against a real food service measures the warm path instead; all three must satisfy the same
// threshold, which is why the budget is stated as a bound rather than derived from one measurement.
export const NUTRITION_BATCH_P95_MS = Number(__ENV['RECIPE_NUTRITION_BATCH_P95_MS'] || 1500);

// The published per-request recipe-id cap (mirrors MAX_NUTRITION_RECIPE_IDS in the authored contract,
// `src/recipes/recipes.schema.ts`). k6 scripts cannot import TypeScript, so this is a restatement — the
// cap scenario asserts the service ACCEPTS exactly this many ids, which is what makes the restatement
// self-checking rather than a second source of truth that can drift silently.
export const MAX_NUTRITION_RECIPE_IDS = Number(__ENV['RECIPE_MAX_NUTRITION_IDS'] || 500);

// A realistic card-grid page — what a list/search surface actually asks about in one call.
export const NUTRITION_PAGE_SIZE = Number(__ENV['RECIPE_NUTRITION_PAGE_SIZE'] || 20);

// The bearer the nutrition scenarios forward so the gateway actually CALLS food.
//
// ⚠️ NOT cosmetic, and the reason the old scenario could not have measured fan-out even with the right
// fixture: `FoodNutritionGateway.lookup` degrades WITHOUT issuing a request when it has no caller
// credential to forward, and the CI load container boots with the dev-auth bypass (`RECIPE_DEV_AUTH_USER_ID`)
// and therefore no bearer. A run with no `Authorization` header measures the short-circuit, never the
// fan-out. `resolveCallerBearerToken` reads the header directly (independently of the bypass), so under the
// bypass ANY string is forwarded; against a real stage this must be a real Clerk token in
// RECIPE_LOAD_TEST_TOKEN, or the service answers 401 and `http_req_failed` trips.
export const NUTRITION_FORWARD_BEARER = TOKEN || __ENV['RECIPE_LOAD_STUB_BEARER'] || 'load-test-forwarded-bearer';

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

// Parse a k6 duration string ('90s', '2m', '1h') to seconds.
function durationToSeconds(value) {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value).trim());

    if (!match) {
        throw new Error(`common.js: unsupported duration '${value}' (expected e.g. '30s', '2m')`);
    }

    return Number(match[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];
}

// Wall-clock length of one `rampStages()` window, in whole seconds. A script whose scenarios must run one
// AFTER another derives their `startTime` from this instead of hardcoding offsets — otherwise raising
// RECIPE_LOAD_HOLD would silently make them overlap, and overlapping scenarios measure each other.
export function rampSeconds() {
    return Math.ceil(durationToSeconds(RAMP_UP) + durationToSeconds(HOLD) + durationToSeconds(RAMP_DOWN));
}

// Trend statistics a script reports. k6's DEFAULT set omits p(99), which leaves the tail invisible in both
// the terminal summary and the `--summary-export` artifact CI uploads — and a threshold whose neighbouring
// percentile you cannot read turns a failure into a guess.
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

// --- Generated fixtures ---------------------------------------------------------------------------
//
// ⚠️ k6's `open()` resolves relative to the directory of the MODULE WHOSE CODE IS EXECUTING at the moment
// of the call — not the process cwd, and not the entry script's directory unconditionally. The distinction
// only shows up in a helper module like this one, and it is exactly what decides './' vs '../'. The loader
// below is a FUNCTION the entry script calls from its INIT context, which resolves against the ENTRY's
// directory — so './<name>' is correct for a fixture beside the entry scripts even though this file sits one
// directory deeper. (food's `lib/common.js` records the same measured table; identity opens its pool at its
// helper's module TOP LEVEL, which is the other row of it and correctly uses '../'. The two are not copies —
// do not reconcile them to one prefix.) VERIFIED on k6 v1.3.0 by running this script from both the package
// directory and the repo root.
//
// GENERATED and GITIGNORED, so it is never present from a fresh checkout: this fails with an actionable
// message naming the prepare step rather than letting k6 report a bare `open() failed`.
const NUTRITION_FIXTURE_FILE = __ENV['RECIPE_NUTRITION_FIXTURE_FILE'] || './perf-fixture.json';

// Load the recipe-id sets + measured fan-out `prepareNutritionFanoutFixture.ts` emitted. INIT context only.
export function loadNutritionFixture() {
    let raw;

    try {
        raw = open(NUTRITION_FIXTURE_FILE);
    } catch (error) {
        throw new Error(
            `common.js: cannot read the nutrition fixture at '${NUTRITION_FIXTURE_FILE}' (${error}). It is ` +
                'generated, gitignored, per-run state — run `DATABASE_URL=… npx tsx ' +
                'tests/load/prepareNutritionFanoutFixture.ts` first (it seeds the two ingredient-overlap ' +
                'recipe sets this scenario measures and emits their MEASURED distinct-food counts).',
            { cause: error },
        );
    }

    const fixture = JSON.parse(raw);

    for (const set of ['fanout', 'overlap', 'page', 'plan']) {
        const seeded = fixture[set];

        if (!seeded || !Array.isArray(seeded.recipeIds) || seeded.recipeIds.length === 0) {
            throw new Error(`common.js: fixture '${NUTRITION_FIXTURE_FILE}' has no ${set}.recipeIds — re-seed it.`);
        }

        // A set that names no food would make its scenario a request-width probe with a one-call fan-out —
        // the defect ADR-0021's residual-risk note records. Fail at INIT rather than pass at the threshold.
        if (!(seeded.distinctFoodCount > 0)) {
            throw new Error(
                `common.js: fixture set '${set}' names ${seeded.distinctFoodCount} distinct foods, so it cannot ` +
                    'exercise the food fan-out at all — re-run the prepare step against a migrated database.',
            );
        }
    }

    return fixture;
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
