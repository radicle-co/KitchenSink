// An author's own food and its ask to make it public, under load (ADR-0029 §5 and §7; private foods spec section 5).
//
// @loadTier deployed-capable — every food it writes is a private authored food of the pool user writing it, withdrawn in the same iteration, and the pool reset's test-purge removes it with its requests
// @loadExcludeTarget prod — it opens publication requests, which land in staff's review queue, and production holds no test-principal containment for that queue yet
//
// WHAT ONE ITERATION DOES, as one pool user (the bearer is picked once per iteration):
//
//   1. `POST /api/v1/foods/authored` — a new private food, named for this run, VU and iteration (the per-author
//      dedup key is the normalized name, so every name is unique to the run);
//   2. `POST …/authored/{id}/publication-request` — the ask (`201`);
//   3. `GET …/authored` and `GET …/authored/{id}/publication-request` — the author's list and the request it opened;
//   4. `PUT /api/v1/foods/{id}` — an edit while the ask is open. A PRIVATE food saves at once (`200`), and the open
//      ask moves to the saved version;
//   5. `DELETE /api/v1/foods/{id}` — the withdrawal (`204`), which closes the pending request.
//
// ⚠️ NOT COVERED: the `202 editPending` answer of `PUT`. It needs a PUBLIC food, and only staff (`food:admin`)
// approve one; a pool user holds no such grant, and this scenario must not make test content public on any stage.
// `tests/foodPublication.integration.test.ts` and the service unit tests pin that answer instead.
//
// ⛔ CLEANUP, AS THE OTHER POOL SCENARIOS DO IT. A withdrawn food is retained (a referencing line must never point at
// nothing), so step 5 leaves a `WITHDRAWN` row per iteration and no open request. The k6 job's pool reset, before and
// after the run (`e2e-seed resetPool --tier k6`), sends each pool user's `POST /api/v1/foods/authored/test-purge`, which
// hard-deletes the caller's private and withdrawn authored foods; their requests go with them (`ON DELETE CASCADE`).
// A hand run against a local service leaves them in the local database until that purge is run.
//
// ⚠️ NO SUCCESS CRITERION NAMES THESE ROUTES, so latency is reported, not gated. What gates on every profile is what a
// slow machine cannot cause: each step's status and that every answer is private.
//
//   npm run test:load:tokens
//   k6 run tests/load/publicationRequests.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job. Run by hand only (owner ruling 2026-09-13).

import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadTokens,
    rampStages,
} from './lib/common.js';

const sessionTokens = new SharedArray('session-tokens', () => loadTokens().users);

/** One VU per pool user at most, as the other authenticated food scenarios hold it. */
const peak = Math.min(PEAK_VUS, sessionTokens.length);

const MACROS = { calories: 120, proteinG: 3, carbsG: 16, fatG: 5 };
const EDITED_MACROS = { calories: 135, proteinG: 3, carbsG: 16, fatG: 5 };

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        publication: {
            executor: 'ramping-vus',
            exec: 'publicationPath',
            startVUs: 0,
            stages: rampStages(peak),
            tags: { op: 'publication' },
        },
    },
    thresholds: {
        'checks{op:publication}': ['rate>0.99'],
        'http_req_failed{op:publication}': ['rate<0.01'],
    },
};

/** This run's mark, so no two runs' food names collide in one author's dedup namespace. */
export function setup() {
    return { run: Date.now().toString(36) };
}

/** JSON headers for a write as `token`. */
function writeHeaders(token) {
    return { ...authHeaders(token), 'Content-Type': 'application/json' };
}

/** Whether an answer has `status` and tells every cache not to keep it, as the author routes all answer. */
const answersPrivately = (res, status) => res.status === status && res.headers['Cache-Control'] === 'private, no-store';

/** One author's food through its ask, an edit, and its withdrawal. */
export function publicationPath(data) {
    const token = forIteration(sessionTokens);
    const name = `k6 publication ${data.run} ${exec.vu.idInTest}-${exec.vu.iterationInScenario}`;

    const created = http.post(`${BASE_URL}/api/v1/foods/authored`, JSON.stringify({ name, macros: MACROS }), {
        headers: writeHeaders(token),
        tags: { operation: 'createAuthored' },
    });
    const id = created.status === 201 ? created.json('id') : undefined;

    if (!check(created, { 'the food is created': (r) => r.status === 201 && typeof id === 'string' })) {
        sleep(1);

        return;
    }

    const asked = http.post(`${BASE_URL}/api/v1/foods/authored/${id}/publication-request`, null, {
        headers: authHeaders(token),
        tags: { operation: 'requestPublication' },
    });
    const listed = http.get(`${BASE_URL}/api/v1/foods/authored`, {
        headers: authHeaders(token),
        tags: { operation: 'listAuthored' },
    });
    const request = http.get(`${BASE_URL}/api/v1/foods/authored/${id}/publication-request`, {
        headers: authHeaders(token),
        tags: { operation: 'readPublicationRequest' },
    });
    const edited = http.put(`${BASE_URL}/api/v1/foods/${id}`, JSON.stringify({ name, macros: EDITED_MACROS }), {
        headers: writeHeaders(token),
        tags: { operation: 'updateAuthored' },
    });
    const withdrawn = http.del(`${BASE_URL}/api/v1/foods/${id}`, null, {
        headers: authHeaders(token),
        tags: { operation: 'withdrawAuthored' },
    });

    check(asked, { 'the ask is opened': (r) => answersPrivately(r, 201) && r.json('request.status') === 'pending' });
    check(listed, {
        'the author lists their foods privately': (r) => answersPrivately(r, 200) && Array.isArray(r.json('items')),
    });
    check(request, { 'the open ask reads back': (r) => answersPrivately(r, 200) && r.json('request.foodId') === id });
    check(edited, { 'a private food saves the edit at once': (r) => r.status === 200 && r.json('id') === id });
    check(withdrawn, { 'the author withdraws the food': (r) => r.status === 204 });
    sleep(1);
}
