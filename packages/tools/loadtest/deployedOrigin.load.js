/**
 * The DEPLOYED-origin k6 script — the per-PR sandbox tier (owner ruling 2026-09-04: "k6 should test the
 * sandbox for the PR").
 *
 * It measures what the three isolated-substrate k6 jobs in `_ci-heavy.yml` structurally CANNOT see: the
 * real deployed path — DNS, the shared ALB, its listener rule, a 0.5-vCPU FARGATE_SPOT task with
 * `desiredCount=1`, and the service's own auth middleware — for THIS PR's preview.
 *
 * ## ⛔ What is GATED and what is only REPORTED, and why the split is not negotiable
 *
 * Every latency budget in this repo (`RECIPE_SAVE_P95_MS=500`, food's `READ_P95_MS`, identity's NFR-011a
 * p99, the derived `NUTRITION_BATCH_P95_MS`) was calibrated against a runner-local container with a
 * dedicated Postgres and no rate limiter. A per-PR preview is a DIFFERENT MACHINE: half a vCPU of
 * reclaimable Spot, one task, a `db.t4g.micro` shared with every other open PR's logical database
 * (ADR-0006), behind an ALB shared with every other service (ADR-0003). Carrying those numbers across
 * would produce a gate that goes red for the neighbours' traffic — and the predictable next step is
 * somebody switching the gate off, which costs more than never having had it.
 *
 * So this script asserts ONLY facts that are true independent of how fast the box is:
 *
 *   • GATED — `deployed_5xx` — the origin must not answer 5xx. A preview that 500s is broken at any speed.
 *   • GATED — `unauthenticated_success` — a protected route must NEVER answer 2xx without a credential.
 *     Zero tolerance, because a slow machine cannot cause this; only a broken auth boundary can.
 *   • REPORTED, NEVER GATED — every latency figure, and the 429 count. These are the numbers this tier
 *     exists to PRODUCE. A budget can be set here only once enough runs exist to know the distribution;
 *     until then a threshold would be a number nobody believes, which is worse than no number at all.
 *
 * ## ⛔ The rate limiter is RESPECTED, not raised
 *
 * `ThrottlerGuard` buckets by client IP and one k6 runner is one IP, so every VU shares one counter
 * (`packages/services/recipe-service/tests/load/README.md`). The isolated jobs get around that by owning
 * the container and cranking `RATE_LIMIT_*` — which that same README warns makes the result stop proving
 * anything about the production limits. A deployed preview is not ours to reconfigure per run, and cranking
 * it there would be worse: the limiter would then be untested on the only substrate that runs the real one.
 *
 * So the shape stays UNDER the limit instead. The two scenarios run SEQUENTIALLY at
 * `TARGET_ARRIVAL_RATE` (default 1/s, one request per iteration), i.e. ~60 requests/minute against a
 * default `RATE_LIMIT_READ` of 120/min — half the budget, with the other half left for the preview's real
 * users. A 429 is therefore a SIGNAL (someone else is loading this preview, or the limit moved), and it is
 * counted and surfaced rather than thresholded.
 *
 * ⚠️ The sample count is small BY CONSTRUCTION — `rate x duration` per series, 90 by default. This repo has
 * already been burned by reading a tail off too few samples: T-203 records a "p95" that was the
 * second-largest of n=30 and moved 3x on runner stalls alone. The summary therefore prints `count` beside
 * every percentile, and the percentiles are read as an order of magnitude, not a budget.
 *
 * Run:
 *   k6 run --env TARGET_BASE_URL=https://recipe-pr-73.commise.app \
 *          --env TARGET_SERVICE=recipe --env PROTECTED_PATH=/api/v1/recipes deployedOrigin.load.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── Config ──────────────────────────────────────────────────────────────────────────────────────────
const BASE_URL = (__ENV.TARGET_BASE_URL || '').replace(/\/$/, '');
const SERVICE = __ENV.TARGET_SERVICE || 'service';
const PROTECTED_PATH = __ENV.PROTECTED_PATH || '';
const HEALTH_PATH = __ENV.HEALTH_PATH || '/health';

// One request per iteration, so the arrival rate IS the request rate — see the rate-limiter note above.
const ARRIVAL_RATE = Number(__ENV.TARGET_ARRIVAL_RATE || 1);
const DURATION = __ENV.TARGET_DURATION || '90s';
const MAX_VUS = Number(__ENV.TARGET_MAX_VUS || 10);
const REQUEST_TIMEOUT = __ENV.TARGET_REQUEST_TIMEOUT || '30s';

// ── Metrics ─────────────────────────────────────────────────────────────────────────────────────────
// GATED. Substrate-independent correctness, both of them.
const fiveXx = new Rate('deployed_5xx');
const unauthenticatedSuccess = new Rate('unauthenticated_success');

// REPORTED. Every one of these is a function of the machine, not of the code.
const healthLatency = new Trend('deployed_health_latency', true);
const authBoundaryLatency = new Trend('deployed_auth_boundary_latency', true);
const throttled = new Counter('deployed_throttled_429');
const transportErrors = new Counter('deployed_transport_errors');

export const options = {
    // Sequential, so the two series never contend for the single task's half-vCPU and each number is
    // attributable to its own scenario.
    scenarios: {
        health: {
            executor: 'constant-arrival-rate',
            exec: 'probeHealth',
            rate: ARRIVAL_RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: Math.min(MAX_VUS, 5),
            maxVUs: MAX_VUS,
            startTime: '0s',
            tags: { series: 'health' },
        },
        authBoundary: {
            executor: 'constant-arrival-rate',
            exec: 'probeAuthBoundary',
            rate: ARRIVAL_RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: Math.min(MAX_VUS, 5),
            maxVUs: MAX_VUS,
            startTime: DURATION,
            tags: { series: 'auth-boundary' },
        },
    },
    // ⛔ CORRECTNESS ONLY. Adding a latency threshold here re-imports a budget calibrated on a different
    // machine — read the docblock before you do it.
    thresholds: {
        deployed_5xx: ['rate<0.01'],
        unauthenticated_success: ['rate==0'],
    },
    summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'max', 'count'],
};

/**
 * Fail at INIT rather than reporting a green run against nothing. An empty base URL would make every
 * request a transport error, which `deployed_5xx` does not count — so the run would pass having measured
 * a misconfiguration.
 */
export function setup() {
    if (!BASE_URL) {
        throw new Error('TARGET_BASE_URL is required — this script measures a DEPLOYED origin, never a local one');
    }

    if (!PROTECTED_PATH) {
        throw new Error('PROTECTED_PATH is required — the auth-boundary series is half of what this asserts');
    }

    return { baseUrl: BASE_URL };
}

/** Record the shared, substrate-independent facts about one response. */
function recordOutcome(response) {
    if (response.error_code !== 0 && response.status === 0) {
        transportErrors.add(1);
        fiveXx.add(false);

        return;
    }

    if (response.status === 429) {
        throttled.add(1);
    }

    fiveXx.add(response.status >= 500);
}

/**
 * The availability + deployed-path series. `/health` is the one route every service leaves unauthenticated
 * (`AuthMiddleware` excludes it), so this measures DNS -> ALB -> listener rule -> task with no credential
 * in play.
 */
export function probeHealth() {
    const response = http.get(`${BASE_URL}${HEALTH_PATH}`, {
        timeout: REQUEST_TIMEOUT,
        tags: { series: 'health' },
    });

    recordOutcome(response);

    // Only a 200 contributes to the latency series: recording a fast 503 would DEFLATE the percentiles and
    // make a failing preview look healthy (`journey.js` invariant 2, same reasoning).
    if (response.status === 200) {
        healthLatency.add(response.timings.duration);
    }

    check(response, {
        'health answers 200': (r) => r.status === 200,
    });
}

/**
 * The auth-boundary series. A protected route with NO `Authorization` header must be refused — and the
 * refusal has to come from the deployed service, which is why it is measured here and not on the isolated
 * substrate, where the recipe container runs under the dev-auth bypass and refuses nothing.
 */
export function probeAuthBoundary() {
    const response = http.get(`${BASE_URL}${PROTECTED_PATH}`, {
        timeout: REQUEST_TIMEOUT,
        tags: { series: 'auth-boundary' },
    });

    recordOutcome(response);
    unauthenticatedSuccess.add(response.status >= 200 && response.status < 300);

    if (response.status === 401 || response.status === 403) {
        authBoundaryLatency.add(response.timings.duration);
    }

    check(response, {
        'a protected route refuses an unauthenticated caller': (r) => r.status === 401 || r.status === 403,
    });
}

/** One row of the reported (never gated) latency table. */
function trendRow(label, metric) {
    if (!metric || !metric.values || !metric.values.count) {
        return `| ${label} | _no samples_ | | | | | 0 |`;
    }

    const at = (key) => `${Math.round(metric.values[key])} ms`;

    return (
        `| ${label} | ${at('min')} | ${at('med')} | ${at('avg')} | ` +
        `${at('p(90)')} | ${at('p(95)')} | ${metric.values.count} |`
    );
}

/**
 * Emit a markdown report a human can read in the job summary, alongside the raw JSON.
 *
 * The header states the substrate on purpose: a number from a shared, half-vCPU Spot preview must never be
 * quoted as this service's latency, and the only reliable place to say so is beside the number.
 *
 * @sideEffect Writes report files (k6 performs the write from the returned map).
 */
export function handleSummary(data) {
    const counter = (name) => data.metrics[name]?.values?.count ?? 0;
    const rate = (name) => data.metrics[name]?.values?.rate ?? 0;

    const report = [
        `### k6 — deployed origin: \`${SERVICE}\` @ ${BASE_URL}`,
        '',
        '**Measured on the per-PR sandbox substrate** (0.5 vCPU `FARGATE_SPOT`, `desiredCount=1`, a shared',
        '`db.t4g.micro` and a shared ALB). Latency below is REPORTED, not gated — see the script docblock.',
        '',
        '| series | min | med | avg | p90 | p95 | n |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        trendRow('health (200)', data.metrics['deployed_health_latency']),
        trendRow('auth boundary (401/403)', data.metrics['deployed_auth_boundary_latency']),
        '',
        '| gated fact | value | bar |',
        '| --- | --- | --- |',
        `| 5xx rate | ${(rate('deployed_5xx') * 100).toFixed(2)}% | < 1% |`,
        `| unauthenticated 2xx rate | ${(rate('unauthenticated_success') * 100).toFixed(2)}% | 0% |`,
        '',
        `429s (rate limiter): **${counter('deployed_throttled_429')}** · transport errors: ` +
            `**${counter('deployed_transport_errors')}**`,
        '',
    ].join('\n');

    return {
        stdout: `\n${report}\n`,
        [`k6-deployed-${SERVICE}-report.md`]: report,
        [`k6-deployed-${SERVICE}-summary.json`]: JSON.stringify(data, null, 2),
    };
}
