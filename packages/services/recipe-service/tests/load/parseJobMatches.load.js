// ADR-0071 — the paste-job match command: POST /api/v1/recipe-parse-jobs/{id}/matches.
//
// @loadTier deployed-capable — paste text is generated rather than opened; it searches the stage's own food service
//   as the caller and enqueues to the stage's own verification queue
//
// ⛔ AUTHORED, NEVER RUN BY A PULL REQUEST (owner rulings 2026-09-13): k6 runs only from a dispatch-only workflow.
//
// Why this route earns its own scenario: its cost is a FAN-OUT no other write has. One request matches every parsed
// food of a paste that has no current match, and each food costs up to two catalog searches AS the cook, in waves of
// four, under a four-second budget, plus one batched refs read and one verification enqueue. Three things can only
// fail at concurrency:
//
//   * The 202's latency is bounded by the budget, not by the paste's size. A p95 that grows with the line count means
//     the budget stopped stopping new waves.
//   * A food outage or a slow search under pressure must store nothing and answer 202. It must never surface as a 5xx,
//     and `http_req_failed` is the tripwire.
//   * The SECOND call for the same job must be cheap: every food is already matched, so it runs no search and sends
//     no message. Its p95 is gated separately, at the poll's budget.
//
// The paste text is FIXED per VU, so a later iteration's lines are copied forward from the first landing (no new
// parse spend) and its proposals meet verdicts already on record (no new review spend). The first iteration of each
// VU pays the parse and the review once. ⚠️ A pool user is a signed TEST principal, so on an enforcing stage (prod)
// the review is never sent at all (ADR-0040): the scenario then measures the matching, not the enqueue.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe-pr-91.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/parseJobMatches.load.js

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

const firstMatchTrend = new Trend('parse_job_first_match_duration', true);
const repeatMatchTrend = new Trend('parse_job_repeat_match_duration', true);

/** The first call's p95 budget: the matcher's four-second budget plus one wave in flight and the view's reads. */
const FIRST_MATCH_P95_MS = Number(__ENV['RECIPE_PARSE_MATCH_P95_MS'] || 6000);

/** The repeat call does no search and sends nothing, so it shares the save budget. */
const REPEAT_MATCH_P95_MS = Number(__ENV['RECIPE_PARSE_MATCH_REPEAT_P95_MS'] || SC009_P95_MS);

/** How many polls a VU waits for its lines to settle before it asks for matches anyway. */
const SETTLE_POLLS = 10;

/** A typical pasted block of real ingredients, so the catalog searches find something to rank. */
const PASTE = [
    '2 cups whole milk',
    '1 teaspoon salt',
    '3 large eggs',
    '1 cup all-purpose flour',
    '2 tablespoons butter',
    '1 teaspoon ground cinnamon',
    '1/2 cup sugar',
    '4 slices bread',
].join('\n');

export const options = {
    scenarios: {
        matchPaste: {
            executor: 'ramping-vus',
            exec: 'matchPaste',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'matchPaste' },
        },
    },
    thresholds: {
        // ⛔ The load-bearing threshold: an outage under pressure is a 202 with nothing stored, never a 5xx.
        http_req_failed: ['rate<0.01'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            'http_req_duration{scenario:matchPaste,operation:firstMatch}': [`p(95)<${FIRST_MATCH_P95_MS}`],
            'http_req_duration{scenario:matchPaste,operation:repeatMatch}': [`p(95)<${REPEAT_MATCH_P95_MS}`],
        }),
    },
};

/**
 * Create the paste job.
 *
 * @returns {string | undefined} The job id, or `undefined` when the create was refused.
 */
function createJob() {
    const res = http.post(`${BASE_URL}/api/v1/recipe-parse-jobs`, JSON.stringify({ text: PASTE }), {
        headers: jsonHeaders(),
        tags: { operation: 'createParseJob' },
    });

    check(res, { 'parse-job create answers 202': (r) => r.status === 202 });

    return res.status === 202 ? JSON.parse(res.body || '{}').id : undefined;
}

/**
 * Poll the job until no line is pending, or the poll allowance runs out.
 *
 * @param {string} id - The job id.
 * @returns {void}
 */
function waitForLines(id) {
    for (let poll = 0; poll < SETTLE_POLLS; poll += 1) {
        const res = http.get(`${BASE_URL}/api/v1/recipe-parse-jobs/${id}`, {
            headers: jsonHeaders(),
            tags: { operation: 'pollParseJob' },
        });
        const lines = res.status === 200 ? JSON.parse(res.body || '{}').lines || [] : [];

        if (lines.length > 0 && lines.every((line) => line.status !== 'pending')) {
            return;
        }

        sleep(PACE_SECONDS);
    }
}

/**
 * Ask for the job's matches and check the contract that must hold under load.
 *
 * @param {string} id - The job id.
 * @param {string} operation - `firstMatch` or `repeatMatch`, the tag the threshold reads.
 * @returns {import('k6/http').RefinedResponse<'text'>} The response.
 */
function proposeMatches(id, operation) {
    // `jsonHeaders()` carries the bearer; the command takes no body.
    const res = http.post(`${BASE_URL}/api/v1/recipe-parse-jobs/${id}/matches`, null, {
        headers: jsonHeaders(),
        tags: { operation },
    });

    check(res, {
        'the match command answers 202': (r) => r.status === 202,
        'every proposed food carries a match key (an object, or null while unmatched)': (r) => {
            const lines = JSON.parse(r.body || '{}').lines || [];

            return lines.every(
                (line) => line.proposal === null || line.proposal.foods.every((food) => 'match' in food),
            );
        },
    });

    return res;
}

export function matchPaste() {
    const id = createJob();

    if (id === undefined) {
        sleep(PACE_SECONDS);

        return;
    }

    sleep(PACE_SECONDS);
    waitForLines(id);

    firstMatchTrend.add(proposeMatches(id, 'firstMatch').timings.duration);
    sleep(PACE_SECONDS);
    repeatMatchTrend.add(proposeMatches(id, 'repeatMatch').timings.duration);
    sleep(PACE_SECONDS);
}
