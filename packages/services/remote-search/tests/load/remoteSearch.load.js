// @loadTier deployed-capable — it drives a deployed copy's CloudFront distribution with URLs signed by its base stage's key, and nothing local stands in for CloudFront's signature check or its cache
// @loadExcludeTarget prod — the miss path shares the function's reserved concurrency with cooks, so a run would take remote results away from them
/**
 * The remote search service under load, through its deployed CloudFront distribution (ADR-0055 points 2, 6 and 7).
 *
 * It sends only the signed requests `prepareSignedUrls.ts` planned (`signedUrls.json`, credential material), in two
 * series run one after the other so each number belongs to one path:
 *
 *   • HITS ask terms the warm-up stored. CloudFront answers them from its cache, and the answer echoes the id of the
 *     request that stored it, never the hit's own. This is the path cooks take for every repeated search.
 *   • PROBES ask terms nobody stored, unadmitted. The function answers each one `428` without calling the source, so
 *     this measures the function and its reserved concurrency, which is small (two at a preview). A `429` is the
 *     function refusing a request over that cap: food reads it as the source being unavailable.
 *
 * ## What is GATED and what is only REPORTED
 *
 *   • GATED — `remote_search_5xx`: no 5xx, from CloudFront or the function.
 *   • GATED — `signature_refused`: CloudFront never refuses a URL signed with the base stage's key.
 *   • GATED — `rid_echo_mismatch`: a cached answer never echoes the hit's own id, and an answer from the function
 *     always does. Food tells a hit from its own source call by exactly this, so either one wrong breaks its
 *     accounting of source calls.
 *   • GATED — `probe_answered_by_source`: an unadmitted probe is never answered with a search result.
 *   • REPORTED, NEVER GATED — every latency, the cache-hit ratio, and the `429` count. A preview's function runs at
 *     a reserved concurrency of two on a shared account, so a budget calibrated anywhere else would redden on the
 *     wrong thing.
 *
 * ## What one run costs, and why it is hand-run only
 *
 * The warm-up admits each warm term once: up to ten USDA calls on the base stage's key, and none once those answers
 * are stored, because a stored answer serves the warm-up too. Admission normally goes through food's shared window
 * (ADR-0053); these ten bypass it. That is why the warm list is short and fixed, and why only a person runs this
 * scenario, through the dispatch-only `remoteSearchLoadtest.yml`.
 *
 * ## Profile
 *
 * Only `LOAD_PROFILE=deployed` (`lib/common.js`): nothing on a runner stands in for CloudFront, so `setup` refuses
 * every other profile rather than measuring nothing.
 *
 * Run (the dispatch-only `remoteSearchLoadtest.yml` does this):
 *   npx tsx tests/load/prepareSignedUrls.ts && k6 run tests/load/remoteSearch.load.js
 */
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

import { LOAD_PROFILE } from './lib/common.js';

// ── Config ──────────────────────────────────────────────────────────────────────────────────────────
// `open()` resolves a relative path against THIS script, which is where the minter writes the plan.
const PLAN = JSON.parse(open(__ENV['REMOTE_SEARCH_SIGNED_URLS_FILE'] || './signedUrls.json'));
const HIT_RATE = Number(__ENV['REMOTE_SEARCH_HIT_RATE'] || 10);
const PROBE_RATE = Number(__ENV['REMOTE_SEARCH_PROBE_RATE'] || 1);
const DURATION = __ENV['REMOTE_SEARCH_DURATION'] || '60s';
const MAX_VUS = Number(__ENV['REMOTE_SEARCH_MAX_VUS'] || 20);
const REQUEST_TIMEOUT = '30s';

// ── Metrics ─────────────────────────────────────────────────────────────────────────────────────────
// GATED. True on any machine, at any speed.
const fiveXx = new Rate('remote_search_5xx');
const signatureRefused = new Rate('signature_refused');
const ridEchoMismatch = new Rate('rid_echo_mismatch');
const probeAnsweredBySource = new Rate('probe_answered_by_source');

// REPORTED.
const hitLatency = new Trend('remote_search_hit_latency', true);
const probeLatency = new Trend('remote_search_probe_latency', true);
const servedFromCache = new Rate('remote_search_served_from_cache');
const throttled = new Counter('remote_search_throttled_429');
const transportErrors = new Counter('remote_search_transport_errors');

export const options = {
    scenarios: {
        hits: {
            executor: 'constant-arrival-rate',
            exec: 'askStored',
            rate: HIT_RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: Math.min(MAX_VUS, 5),
            maxVUs: MAX_VUS,
            startTime: '0s',
            tags: { series: 'hit' },
        },
        probes: {
            executor: 'constant-arrival-rate',
            exec: 'probeMiss',
            rate: PROBE_RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: Math.min(MAX_VUS, 5),
            maxVUs: MAX_VUS,
            startTime: DURATION,
            tags: { series: 'probe' },
        },
    },
    summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'max', 'count'],
    // ⛔ CORRECTNESS ONLY: read the docblock before adding a latency threshold.
    thresholds: {
        remote_search_5xx: ['rate<0.01'],
        signature_refused: ['rate==0'],
        rid_echo_mismatch: ['rate==0'],
        probe_answered_by_source: ['rate==0'],
    },
};

/**
 * Whether CloudFront answered from its cache.
 *
 * @param response - The response.
 * @returns True for a hit.
 */
function fromCache(response) {
    return /hit from cloudfront/iu.test(response.headers['X-Cache'] || '');
}

/**
 * Record what every response says, whichever series sent it.
 *
 * @param response - The response.
 * @returns False when nothing answered.
 */
function recordOutcome(response) {
    if (response.status === 0) {
        transportErrors.add(1);
        fiveXx.add(false);

        return false;
    }

    if (response.status === 429) {
        throttled.add(1);
    }

    fiveXx.add(response.status >= 500);
    signatureRefused.add(response.status === 403);

    return true;
}

/**
 * Warm the cache: one admitted request per warm term, before either series starts.
 *
 * @returns The hits whose term was stored, which are the only ones a cache can be asked to answer.
 */
export function setup() {
    if (LOAD_PROFILE !== 'deployed') {
        throw new Error(
            `LOAD_PROFILE is '${LOAD_PROFILE}': the remote search scenario runs on the deployed profile only`,
        );
    }

    if (Date.parse(PLAN.expiresAt) < Date.now() + 10 * 60_000) {
        throw new Error(`the signed URLs expire at ${PLAN.expiresAt}; mint fresh ones with prepareSignedUrls.ts`);
    }

    const stored = new Set();

    for (const request of PLAN.warm) {
        const response = http.get(request.url, { timeout: REQUEST_TIMEOUT, tags: { series: 'warm' } });

        recordOutcome(response);

        if (response.status === 200) {
            stored.add(request.term);
        }
    }

    const hits = PLAN.hits.filter((request) => stored.has(request.term));

    if (hits.length === 0) {
        throw new Error(`no warm term was stored at ${PLAN.origin}, so the hit series has nothing to ask`);
    }

    return { hits };
}

/**
 * The hit series: a stored term, asked unadmitted under its own request id.
 *
 * @param data - What `setup` returned.
 */
export function askStored(data) {
    const request = data.hits[exec.scenario.iterationInTest % data.hits.length];
    const response = http.get(request.url, { timeout: REQUEST_TIMEOUT, tags: { series: 'hit' } });

    if (!recordOutcome(response)) {
        return;
    }

    const cached = fromCache(response);
    const echoed = response.headers[headerName()] || '';

    servedFromCache.add(cached);

    if (response.status === 200 && cached) {
        hitLatency.add(response.timings.duration);
    }

    // A cached answer replays the request that stored it, which may be an earlier run's; the function replays the
    // request it was sent.
    if (response.status === 200 || response.status === 428) {
        ridEchoMismatch.add(cached ? echoed === '' || echoed === request.rid : echoed !== request.rid);
    }

    check(response, {
        'a stored term is answered 200 from the cache': (r) => r.status === 200 && cached,
    });
}

/**
 * The probe series: a term nobody stored, unadmitted, so the function answers it without a source call.
 */
export function probeMiss() {
    const request = PLAN.probes[exec.scenario.iterationInTest % PLAN.probes.length];
    const response = http.get(request.url, { timeout: REQUEST_TIMEOUT, tags: { series: 'probe' } });

    if (!recordOutcome(response)) {
        return;
    }

    probeAnsweredBySource.add(response.status === 200);

    if (response.status === 428) {
        probeLatency.add(response.timings.duration);
        ridEchoMismatch.add((response.headers[headerName()] || '') !== request.rid);
    }

    check(response, {
        'a probe is answered "not admitted" by the function': (r) => r.status === 428,
    });
}

/**
 * The request-id header as k6 presents response headers: each word capitalised.
 *
 * @returns The header name.
 */
function headerName() {
    return PLAN.ridHeader.replace(/(^|-)([a-z])/gu, (_match, dash, letter) => `${dash}${letter.toUpperCase()}`);
}
