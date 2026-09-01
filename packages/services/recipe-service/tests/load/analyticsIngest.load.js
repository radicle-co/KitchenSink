// U4 — analytics ingest scenario (analytics plan U4 / origin R13, SC4's load half).
//
// Drives POST /ingest/v1/events under ramping concurrency. This route earns a scenario because its load
// properties are exactly what the design promises and only concurrency can test:
//
//   * The landing is ONE multi-row INSERT with a partial-index ON CONFLICT — the cheapest write in the
//     service — so its p95 must hold comfortably inside the ordinary write budget. A p95 approaching the
//     save budget means the events store's indexes have grown pathological or the fold trigger is doing
//     more than a delta.
//   * The per-instance in-flight bound (KTD4) sheds CLIENT-DOOR load first. Under this scenario's
//     pressure a shed answers 202 with `landed: 0` — a SUCCESS, never an error — so `http_req_failed`
//     rising here means the isolation contract broke, not that the cap engaged.
//   * Every iteration mints fresh UUIDs, so this measures the INSERT path; the dedup (conflict) path is
//     covered functionally in the integration tier and is CHEAPER, not dearer, under load.
//
// ⛔ 429s are EXCLUDED from failure: the ingest door is deliberately rate-capped per user
// (RATE_LIMIT_ANALYTICS), and a load token concentrating VUs on one user WILL hit it — that is the cap
// working. The check counts 202s among non-429 responses instead.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/analyticsIngest.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { BASE_URL, authHeaders, rampStages, SC009_P95_MS } from './lib/common.js';

const ingestTrend = new Trend('analytics_ingest_duration', true);

/** The p95 budget: shares the SAVE budget — one short INSERT, no fan-out, no external calls. */
const INGEST_P95_MS = Number(__ENV['RECIPE_ANALYTICS_INGEST_P95_MS'] || SC009_P95_MS);

export const options = {
    scenarios: {
        ingest: {
            executor: 'ramping-vus',
            startVUs: 1,
            stages: rampStages(),
        },
    },
    thresholds: {
        analytics_ingest_duration: [`p(95)<${INGEST_P95_MS}`],
        // Shed and rate-cap are successes; anything else failing means the door broke under load.
        http_req_failed: ['rate<0.01'],
    },
};

/** One UUID v4 per event, minted per iteration — the idempotency key contract (KTD5). */
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;

        return v.toString(16);
    });
}

function batch() {
    return JSON.stringify({
        events: [
            {
                type: 'query_outcome',
                eventId: uuid(),
                occurredAt: new Date().toISOString(),
                query: `load probe ${uuid().slice(0, 8)}`,
                served: [
                    { group: 'local', label: 'Load probe local' },
                    { group: 'catalog', label: 'Load probe catalog', foodId: 'food-load-1' },
                ],
                outcome: { kind: 'no_pick' },
            },
        ],
    });
}

export default function scenario() {
    const res = http.post(`${BASE_URL}/ingest/v1/events`, batch(), {
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        tags: { name: 'analytics_ingest' },
    });

    ingestTrend.add(res.timings.duration);

    if (res.status !== 429) {
        check(res, {
            'ingest answers 202': (r) => r.status === 202,
        });
    }

    sleep(0.5);
}
