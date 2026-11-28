// Staff correction-hold clear load scenario (ADR-0106): `POST /api/v1/recipes/:id/source-correction/hold-clear`.
//
// @loadTier substrate-bound — the service must be booted trusting the throwaway Clerk key the prepare step minted
//   (CLERK_JWT_KEY), and the pool is held recipes it created; a deployed stage trusts the real signer
//
// Two shared-iterations scenarios run together:
//   - `clear` — each iteration clears ONE distinct held recipe with its preview's correction id (a recipe can be cleared
//               once), and asserts 200 with `result: 'cleared'`.
//   - `stale` — sends a wrong correction id for a recipe that stays held and asserts `409 HOLD_CLEAR_CONFLICT` under load;
//               the refusal writes nothing, so those recipes are reused.
//
// The staff token is signed RS256, which k6 cannot do, so `prepareHoldClearFixture.ts` mints it and builds the held recipes
// first; this script loads the pool via `open()`.
//
//   RECIPE_API_BASE_URL=http://localhost:3000 npx tsx tests/load/prepareHoldClearFixture.ts
//   #   boot recipe-service with CLERK_JWT_KEY="$(cat tests/load/holdClearPublicKey.pem)",
//   #   CLERK_AUTHORIZED_PARTIES=http://localhost:3000 and a high RATE_LIMIT_WRITE
//   k6 run -e RECIPE_API_BASE_URL=http://localhost:3000 tests/load/holdClear.load.js
//
// A threshold breach exits k6 non-zero.

import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

import { BASE_URL, PEAK_VUS, uuidv4 } from './lib/common.js';

// p95 budget (ms) for the clear: one locked chain walk, the release and one record insert. Env-tunable.
const HOLD_CLEAR_P95_MS = Number(__ENV['RECIPE_HOLD_CLEAR_P95_MS'] || 800);
const POOL_FILE = __ENV['RECIPE_HOLD_CLEAR_POOL_FILE'] || './holdClearPool.json';
const STALE_ITERATIONS = Number(__ENV['RECIPE_HOLD_CLEAR_STALE_ITERATIONS'] || 200);

const pool = JSON.parse(open(POOL_FILE));
const clearEntries = new SharedArray('hold-clear-entries', () => pool.clear);
const staleEntries = new SharedArray('hold-clear-stale-entries', () => pool.stale);

export const options = {
    scenarios: {
        clear: {
            executor: 'shared-iterations',
            exec: 'clearPath',
            vus: Math.min(PEAK_VUS, clearEntries.length),
            // One iteration per pool entry: a recipe is cleared once, so the pool sizes the run.
            iterations: clearEntries.length,
            maxDuration: '10m',
            tags: { op: 'clear' },
        },
        stale: {
            executor: 'shared-iterations',
            exec: 'stalePath',
            vus: Math.max(1, Math.ceil(PEAK_VUS / 2)),
            iterations: STALE_ITERATIONS,
            maxDuration: '10m',
            tags: { op: 'stale' },
        },
    },
    thresholds: {
        'http_req_duration{operation:holdClear}': [`p(95)<${HOLD_CLEAR_P95_MS}`],
        // Scoped to the accept op: the stale scenario's 409s are EXPECTED, so a global rate would trip on them.
        'http_req_failed{op:clear}': ['rate<0.01'],
        'checks{op:clear}': ['rate>0.99'],
        'checks{op:stale}': ['rate>0.99'],
    },
};

/** POST the clear as staff for `entry` with the given correction id. */
function postClear(entry, correctionId, op) {
    return http.post(
        `${BASE_URL}/api/v1/recipes/${entry.recipeId}/source-correction/hold-clear`,
        JSON.stringify({ ownerAccountId: entry.ownerAccountId, correctionId, reason: 'k6 hold-clear load run.' }),
        {
            headers: {
                Authorization: `Bearer ${pool.staffToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            tags: { operation: op },
        },
    );
}

export function clearPath() {
    const entry = clearEntries[exec.scenario.iterationInTest];
    const res = postClear(entry, entry.correctionId, 'holdClear');

    check(res, {
        'clear 200': (r) => r.status === 200,
        'result cleared': (r) => r.status === 200 && r.json('result') === 'cleared',
    });
}

export function stalePath() {
    const entry = staleEntries[exec.scenario.iterationInTest % staleEntries.length];
    const res = postClear(entry, uuidv4(), 'holdClearStale');

    check(res, {
        'stale 409': (r) => r.status === 409,
        'stale HOLD_CLEAR_CONFLICT': (r) => r.status === 409 && r.json('code') === 'HOLD_CLEAR_CONFLICT',
    });
}
