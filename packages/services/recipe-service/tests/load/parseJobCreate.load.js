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
// ⛔ THE DAILY IMPORT ALLOWANCE (004 FR-022) BOUNDS THIS SCRIPT. Every create spends one unit of a user's 200-a-day
// allowance (a trailing 24 hours), and nothing resets a pool user's ledger between k6 runs. A ramp that creates as fast
// as the pace lets it would spend a pool user's whole day in a minute and then measure 429s. So each VU stops creating
// once it has used its share of `PASTES_PER_USER` (default 60, so three runs inside a day still fit under 200).
//
// A fourth scenario, `quotaRefusal`, asserts the refusal itself: `429`, the code `IMPORT_QUOTA_EXCEEDED`, and a
// `details.resetsAt` that is a future ISO instant within 24 hours. It drains one user's allowance ON PURPOSE, so it never
// borrows a pool user: it runs only for a throwaway user NOBODY ELSE USES (not a pool member), named by
// `RECIPE_QUOTA_HANDLES_FILE` (a sign-in handle, so the bearer is re-minted like the pool's) or, on the substrate profile,
// by a static `RECIPE_QUOTA_TOKEN`. It starts WITH the ramps (a static bearer would not outlive waiting for them) and
// paces like every other scenario, so about 200 creates take ten minutes on the deployed profile. A rerun within the day
// finds that user already refused and asserts on the first request, which is cheap.
//
// A third, `pollProgress` (plan 2026-10-15-011), drives the READ every open paste issues every few seconds: since each
// pending line reports its phase, `GET /recipe-parse-jobs/:id` computes ages with the database clock and a window over
// the job's lines. It polls a 200-line job, the read's worst case, and checks every pending line carries its progress.
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
    TOKEN_POOL,
    whenSubstrate,
    PACE_SECONDS,
    iterationPause,
    freshBearer,
    loadSessionHandles,
} from './lib/common.js';

const createTrend = new Trend('parse_job_create_duration', true);
const pollTrend = new Trend('parse_job_poll_duration', true);

/** The p95 budget for a TYPICAL paste's 202. Shares the SAVE budget: one transaction plus one queue trip. */
const TYPICAL_P95_MS = Number(__ENV['RECIPE_PARSE_JOB_P95_MS'] || SC009_P95_MS);

/**
 * The p95 budget for the 200-line cap. Double the typical budget, NOT proportional to the 25× line count —
 * that sub-linearity IS the concurrent-batch property this scenario exists to hold.
 */
const MAX_PASTE_P95_MS = Number(__ENV['RECIPE_PARSE_JOB_MAX_P95_MS'] || TYPICAL_P95_MS * 2);

/** The service's daily import allowance per user (004 FR-022, plan.md §5). Mirrors `IMPORT_ALLOWANCE_RULES.paste.limit`. */
const DAILY_ALLOWANCE = Number(__ENV['RECIPE_IMPORT_DAILY_LIMIT'] || 200);

/**
 * Pastes a pool user may receive from this run's ramping scenarios. 60 leaves room for three runs inside the allowance's
 * 24-hour window, because nothing resets a pool user's ledger between runs.
 */
const PASTES_PER_USER = Number(__ENV['RECIPE_PARSE_JOB_PASTES_PER_USER'] || 60);

/** Users the ramping scenarios spread over: the whole pool; a hand run has one. */
const RAMPING_USERS = Math.max(1, TOKEN_POOL.length);

/**
 * The throwaway user `quotaRefusal` drains, used by NOTHING else: a static bearer (substrate) and/or a sign-in handle
 * (deployed, re-minted). Neither present, the scenario does not run: it must never be pointed at a pool user (their ledger
 * survives the run for 24 hours) or at a hand run's only token.
 */
const QUOTA_TOKEN = __ENV['RECIPE_QUOTA_TOKEN'] || '';
const QUOTA_HANDLES = loadSessionHandles('RECIPE_QUOTA_HANDLES_FILE');

/** Whether the refusal scenario runs. */
const QUOTA_SCENARIO = QUOTA_TOKEN !== '' || QUOTA_HANDLES.length > 0;

/** The peak of each ramping scenario, exactly as `rampStages` will set it (the deployed profile pins it to the pool). */
const SCENARIO_PEAKS = [PEAK_VUS, Math.max(1, Math.floor(PEAK_VUS / 4)), PEAK_VUS].map(
    (peak) => rampStages(peak)[0].target,
);

/**
 * Creates one VU may issue. A user's VUs are the ramping VUs spread over `RAMPING_USERS` (VU ids are contiguous, so
 * no user holds more than `ceil(total / users)` of them; `quotaRefusal`'s VU takes an id and is counted too), and each
 * VU's share keeps that user under `PASTES_PER_USER`.
 */
const CREATES_PER_VU = Math.max(
    1,
    Math.floor(
        PASTES_PER_USER /
            Math.ceil((SCENARIO_PEAKS.reduce((sum, peak) => sum + peak, 0) + (QUOTA_SCENARIO ? 1 : 0)) / RAMPING_USERS),
    ),
);

/** Creates THIS VU has issued. Module state is per-VU in k6, which is exactly the scope the budget needs. */
let createdByThisVu = 0;

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
        pollProgress: {
            executor: 'ramping-vus',
            exec: 'pollProgress',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'pollProgress' },
        },
        // Starts WITH the ramps: it shares no user with them, and every threshold is filtered by scenario tag.
        ...(QUOTA_SCENARIO
            ? {
                  quotaRefusal: {
                      executor: 'per-vu-iterations',
                      exec: 'quotaRefusal',
                      vus: 1,
                      iterations: 1,
                      maxDuration: '15m',
                      tags: { scenario: 'quotaRefusal' },
                  },
              }
            : {}),
    },
    thresholds: {
        // The refusal at the limit is a contract, not a latency: every check in it must hold.
        ...(QUOTA_SCENARIO ? { 'checks{scenario:quotaRefusal}': ['rate==1'] } : {}),
        // ⛔ The load-bearing threshold: an SQS failure under pressure is a 202 with retryable lines, never a 5xx.
        http_req_failed: ['rate<0.01'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            'http_req_duration{scenario:typicalPaste}': [`p(95)<${TYPICAL_P95_MS}`],
            'http_req_duration{scenario:maxPaste}': [`p(95)<${MAX_PASTE_P95_MS}`],
            // The poll is a READ, so it shares the typical paste's budget rather than earning a looser one.
            'http_req_duration{scenario:pollProgress,operation:pollParseJob}': [`p(95)<${TYPICAL_P95_MS}`],
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
    // ⛔ THE BUDGET (see the header): past this VU's share the pool user's allowance would be spent, and what followed
    // would be a measurement of 429s. Idle instead, so the run keeps its shape without spending a unit.
    if (createdByThisVu >= CREATES_PER_VU) {
        return undefined;
    }

    createdByThisVu += 1;

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
        'parse-job create answers 202 (a 429 here means the per-user budget above was exceeded)': (r) =>
            r.status === 202,
        'the job is running or partial, never silently absent': (r) => {
            const body = JSON.parse(r.body || '{}');

            return body.status === 'running' || body.status === 'partial';
        },
    });

    return res.status === 202 ? JSON.parse(res.body || '{}').id : undefined;
}

export function typicalPaste() {
    createJob(typicalText(`${__VU}-${__ITER}`));
    sleep(PACE_SECONDS);
}

export function maxPaste() {
    createJob(maxText(`${__VU}-${__ITER}`));
    sleep(iterationPause(2));
}

/** How many times one VU reads its job: a cook watching a paste for half a minute at the 4 s running cadence. */
const POLLS_PER_JOB = 8;

export function pollProgress() {
    const id = createJob(maxText(`poll-${__VU}-${__ITER}`));

    if (id === undefined) {
        sleep(PACE_SECONDS);

        return;
    }

    for (let poll = 0; poll < POLLS_PER_JOB; poll += 1) {
        const res = http.get(`${BASE_URL}/api/v1/recipe-parse-jobs/${id}`, {
            headers: jsonHeaders(),
            tags: { operation: 'pollParseJob' },
        });

        pollTrend.add(res.timings.duration);
        check(res, {
            'parse-job poll answers 200': (r) => r.status === 200,
            'every pending line says what it is doing': (r) => {
                const lines = JSON.parse(r.body || '{}').lines || [];

                return lines.every((line) =>
                    line.status === 'pending'
                        ? line.progress !== null && line.progress !== undefined
                        : line.progress === null,
                );
            },
        });
        sleep(PACE_SECONDS);
    }
}

/** The 24 h window plus clock skew between the runner and the service. */
const RESETS_AT_SLACK_MS = 24 * 3_600_000 + 5 * 60_000;

/** How many burst-throttle answers (`TOO_MANY_REQUESTS`) the scenario waits out before it gives up. */
const MAX_THROTTLE_WAITS = 60;

/**
 * Spend the dedicated user's allowance to the limit and assert what the refusal says (004 FR-022).
 *
 * Runs at most `DAILY_ALLOWANCE + 1` counted creates and stops at the first `IMPORT_QUOTA_EXCEEDED` — a user already at
 * the limit from an earlier run today is refused on the first. A burst-throttle `429` (`TOO_MANY_REQUESTS`) is a
 * different answer with a different code: it is waited out and not counted, so it can neither end the scenario nor pass
 * for the quota. `responseCallback` makes 202 and 429 EXPECTED for these requests only, so the one refusal is not counted
 * as a service failure by `http_req_failed`.
 *
 * @returns {void}
 */
export function quotaRefusal() {
    let throttled = 0;

    for (let attempt = 0; attempt <= DAILY_ALLOWANCE;) {
        // Re-minted each time it is older than 45 seconds, so a ten-minute loop never presents an expired bearer.
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${freshBearer(QUOTA_HANDLES, QUOTA_TOKEN)}`,
        };
        const res = http.post(
            `${BASE_URL}/api/v1/recipe-parse-jobs`,
            JSON.stringify({ text: `1 cup ${LINE_PREFIX} quota-${String(attempt)}-${String(throttled)}` }),
            {
                headers,
                tags: { operation: 'createParseJob' },
                responseCallback: http.expectedStatuses(202, 429),
            },
        );
        const body = res.status === 429 ? JSON.parse(res.body || '{}') : {};

        if (res.status === 429 && body.code === 'TOO_MANY_REQUESTS' && throttled < MAX_THROTTLE_WAITS) {
            throttled += 1;
            sleep(PACE_SECONDS);

            continue;
        }

        if (res.status !== 429) {
            attempt += 1;
            sleep(PACE_SECONDS);

            continue;
        }

        const resetsAt = Date.parse((body.details || {}).resetsAt);

        check(res, {
            'the spent allowance answers 429': (r) => r.status === 429,
            'with the distinct code IMPORT_QUOTA_EXCEEDED, not the throttle’s': () =>
                body.code === 'IMPORT_QUOTA_EXCEEDED',
            'resetsAt is a future ISO instant within 24 hours': () =>
                !Number.isNaN(resetsAt) && resetsAt > Date.now() - 60_000 && resetsAt < Date.now() + RESETS_AT_SLACK_MS,
            'and nothing else about the ledger is on the wire': () =>
                Object.keys(body.details || {}).join(',') === 'resetsAt',
        });

        return;
    }

    // The limit was never reached: the allowance is not enforced (or this user's budget is larger than DAILY_ALLOWANCE).
    check(null, { 'a 429 IMPORT_QUOTA_EXCEEDED arrives within DAILY_ALLOWANCE + 1 creates': () => false });
}
