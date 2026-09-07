// U9 — parse-job create scenario (plan U9, origin D9/R13).
//
// @loadTier deployed-capable — paste text is generated rather than opened; it enqueues to the stage's own SQS and CRF
//   Lambda
//
// Drives POST /api/v1/recipe-parse-jobs under ramping concurrency. This route earns its own scenario
// because its cost under load is a FAN-OUT property no other endpoint has: one synchronous request writes
// one job row plus up to 200 line rows in a transaction AND issues up to 20 concurrent SQS
// `SendMessageBatch` calls before answering. Two things can only fail at concurrency:
//
//   * The 202's latency is bounded by the SLOWEST batch, not the sum — `sqsBatchQueue.ts` sends batches
//     concurrently and pins connection/request timeouts precisely so a paste-sized job costs one round
//     trip's latency. A p95 that scales with paste SIZE means that concurrency was lost in a refactor.
//   * An enqueue failure under pressure must degrade to `failed_retryable` lines inside a 202, NEVER
//     surface as a 5xx — the job exists whether or not its messages went out, and `http_req_failed` is
//     the tripwire.
//
// Two paste shapes are driven deliberately: `typicalPaste` (8 lines — the common recipe block, the latency
// budget that matters to a cook mid-flow) and `maxPaste` (200 lines at the admission cap — the fan-out
// worst case that exercises 20 concurrent batches per request).
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/parseJobCreate.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    jsonHeaders,
    rampStages,
    PEAK_VUS,
    SC009_P95_MS,
    whenSubstrate,
    PACE_SECONDS,
} from './lib/common.js';

const createTrend = new Trend('parse_job_create_duration', true);

/** The p95 budget for a TYPICAL paste's 202. Shares the SAVE budget: one transaction plus one queue trip. */
const TYPICAL_P95_MS = Number(__ENV['RECIPE_PARSE_JOB_P95_MS'] || SC009_P95_MS);

/**
 * The p95 budget for the 200-line cap. Double the typical budget, NOT proportional to the 25× line count —
 * that sub-linearity IS the concurrent-batch property this scenario exists to hold.
 */
const MAX_PASTE_P95_MS = Number(__ENV['RECIPE_PARSE_JOB_MAX_P95_MS'] || TYPICAL_P95_MS * 2);

/** An identifiable line prefix, so a load run's jobs are recognisable in the parse tables afterwards. */
const LINE_PREFIX = 'k6-load parse line';

/** A typical pasted ingredient block. Unique text per VU/iteration so digests do not collide in the cache. */
function typicalText(seed) {
    return Array.from(
        { length: 8 },
        (_, index) => `${String(index + 1)} cups ${LINE_PREFIX} ${seed}-${String(index)}`,
    ).join('\n');
}

/** A paste at the 200-line admission cap. */
function maxText(seed) {
    return Array.from(
        { length: 200 },
        (_, index) => `${String(index + 1)} g ${LINE_PREFIX} ${seed}-${String(index)}`,
    ).join('\n');
}

export const options = {
    scenarios: {
        typicalPaste: {
            executor: 'ramping-vus',
            exec: 'typicalPaste',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'typicalPaste' },
        },
        maxPaste: {
            executor: 'ramping-vus',
            exec: 'maxPaste',
            // A quarter of the peak: the cap case exists to prove sub-linear latency, not to size the fleet
            // for an unrealistic all-cooks-paste-200-lines-at-once storm.
            startVUs: 0,
            stages: rampStages(Math.max(1, Math.floor(PEAK_VUS / 4))),
            tags: { scenario: 'maxPaste' },
        },
    },
    thresholds: {
        // ⛔ The load-bearing threshold: an SQS failure under pressure is a 202 with retryable lines, never a 5xx.
        http_req_failed: ['rate<0.01'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            'http_req_duration{scenario:typicalPaste}': [`p(95)<${TYPICAL_P95_MS}`],
            'http_req_duration{scenario:maxPaste}': [`p(95)<${MAX_PASTE_P95_MS}`],
        }),
    },
};

/**
 * Issue one create and assert the contract that must hold under load.
 *
 * @param {string} text - The pasted block.
 * @returns {void}
 */
function createJob(text) {
    // ⛔ `jsonHeaders()`, NOT `authHeaders()` — this call carries a JSON BODY. k6 sets no `Content-Type`
    // for a string body (MEASURED: an echo server sees `content-type: null` with `authHeaders()` and
    // `application/json` with `jsonHeaders()`), and express's JSON parser only parses that media type. With
    // no type the body reaches the pipe unparsed, `text` is `undefined`, and the strict wire schema answers
    // `400 VALIDATION_FAILED` — which is what this scenario did on every one of 4,631 iterations. The
    // failure is silent-looking on both checks at once: a 400 envelope carries no `status`, so "answers 202"
    // AND "running or partial" fail together and look like an outage rather than a malformed request. Every
    // OTHER write script here already sends the type; the ones that use `authHeaders()` post a `null` body.
    const res = http.post(`${BASE_URL}/api/v1/recipe-parse-jobs`, JSON.stringify({ text }), {
        headers: jsonHeaders(),
        tags: { operation: 'createParseJob' },
    });

    createTrend.add(res.timings.duration);
    check(res, {
        'parse-job create answers 202': (r) => r.status === 202,
        'the job is running or partial, never silently absent': (r) => {
            const body = JSON.parse(r.body || '{}');

            return body.status === 'running' || body.status === 'partial';
        },
    });
}

export function typicalPaste() {
    createJob(typicalText(`${__VU}-${__ITER}`));
    sleep(PACE_SECONDS);
}

export function maxPaste() {
    createJob(maxText(`${__VU}-${__ITER}`));
    sleep(2);
}
