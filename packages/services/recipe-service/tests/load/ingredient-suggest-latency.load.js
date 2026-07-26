// Blended-ingredient-typeahead latency scenario (search Stage 2).
//
// Drives GET /v1/ingredients/suggest under ramping concurrency. This route is the one place in the recipe
// service where a CROSS-SERVICE HTTP call sits on a PER-KEYSTROKE path, so it is also the one place where the
// F2 availability budget has to hold under load rather than just in a unit test:
//
//   * The blend issues the recipe-local Postgres read and the food-catalog read CONCURRENTLY, so a healthy
//     response should cost ~max(local, catalog), not their sum.
//   * The catalog read is bounded by a short transport timeout (default 600ms) and degrades to local-only
//     instead of failing. So the WORST case is roughly "local read + the timeout", and a p95 above that means
//     either the bound is not being enforced or the concurrency has collapsed into sequential awaits.
//
// That is why this file exists as its own scenario instead of a case inside `search-latency.load.js`: the
// budget being defended here is a DEGRADATION bound, not a query-cost bound, and the two would be misleading
// under one threshold.
//
// The failure-rate threshold is the second half of the F2 proof and is deliberately strict: an unavailable or
// slow food service must NOT produce non-2xx responses here. If food-service is down during the run, this
// scenario should still be ~100% 200s (with an empty catalog section) — a rising `http_req_failed` means the
// fallback is leaking the dependency's failure to the caller, which is exactly the regression F2 forbids.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/ingredient-suggest-latency.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { BASE_URL, authHeaders, rampStages, PEAK_VUS, SUGGEST_P95_MS } from './lib/common.js';

const suggestTrend = new Trend('ingredient_suggest_duration', true);

// Prefixes a real user types, at the >=2-char trigger threshold (REQ-057) the client enforces. A spread of
// lengths and initial letters so the run does not sit on one cached plan or one trigram bucket.
const PREFIXES = ['ch', 'chi', 'chick', 'flo', 'flour', 'su', 'sug', 'but', 'butt', 'to', 'tom', 'oli', 'sal'];

export const options = {
    scenarios: {
        suggest: {
            executor: 'ramping-vus',
            exec: 'suggestPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'suggest' },
        },
    },
    thresholds: {
        // The blend must stay inside its per-keystroke budget even when the food catalog is degrading.
        'http_req_duration{operation:suggestIngredients}': [`p(95)<${SUGGEST_P95_MS}`],
        // F2: a slow/absent food service degrades to local-only — it must never surface as a failed request.
        http_req_failed: ['rate<0.01'],
    },
};

export function suggestPath() {
    const prefix = PREFIXES[(__ITER + __VU) % PREFIXES.length];

    const res = http.get(`${BASE_URL}/v1/ingredients/suggest?q=${encodeURIComponent(prefix)}&limit=10`, {
        headers: authHeaders(),
        tags: { operation: 'suggestIngredients' },
    });

    suggestTrend.add(res.timings.duration);

    check(res, {
        'suggest 200': (r) => r.status === 200,
        // The envelope is well-formed and the availability discriminant is one of the three known states —
        // a body that lost `catalogAvailability` would leave clients unable to tell degraded from healthy.
        'suggest returns a sectioned envelope': (r) => {
            if (r.status !== 200) {
                return false;
            }

            let body;

            try {
                body = r.json();
            } catch {
                return false;
            }

            return (
                body !== null &&
                Array.isArray(body.suggestions) &&
                ['ok', 'unavailable', 'disabled'].indexOf(body.catalogAvailability) !== -1
            );
        },
        // Sectioning is a contract, not a cosmetic: every `local` suggestion must precede every `catalog`
        // one, or a client rendering two stable lists would interleave them.
        'local section precedes catalog section': (r) => {
            if (r.status !== 200) {
                return false;
            }

            let suggestions;

            try {
                suggestions = r.json().suggestions;
            } catch {
                return false;
            }

            if (!Array.isArray(suggestions)) {
                return false;
            }

            let seenCatalog = false;

            for (const suggestion of suggestions) {
                if (suggestion.provenance === 'catalog') {
                    seenCatalog = true;
                } else if (seenCatalog) {
                    return false; // a `local` after a `catalog` — the sections interleaved
                }
            }

            return true;
        },
    });

    // Roughly a debounced keystroke cadence rather than a tight spin, so the arrival pattern resembles real
    // typeahead traffic instead of a synthetic hammer.
    sleep(0.3);
}
