// The admin user-search list — the one identity query whose cost grows with the table.
//
// `GET /api/v1/admin/users` filters with `ilike '%needle%'` on `users.email` / `users.name`
// (`admin.service.ts`). A btree index CANNOT serve a leading-wildcard match, so `users_email_idx` and
// `users_name`'s index are both unusable and Postgres sequentially scans the table. Every other identity
// read is an indexed single-row lookup whose cost is flat; this one is O(users). That makes it the only
// endpoint in the service that can be fast today and unusable later with no code change at all, which is
// exactly what a load tier should catch BEFORE an operator hits it during an incident.
//
// The scenario is built as a CONTRAST so the finding is unambiguous rather than a bare number:
//
//   `searchMiss`  `?email=` with a needle matching ZERO rows — a guaranteed full scan (the `limit 50` can
//                 never be satisfied early, so the planner cannot short-circuit). The honest worst case.
//   `searchName`  the same scan against `users.name`.
//   `searchHit`   `?email=` matching exactly one row — proves the filter still RETURNS data. Without it a
//                 broken predicate that matched nothing would report the fastest p95 in the suite.
//   `lookup`      `?sub=` — `eq(users.id, …)`, a PRIMARY KEY probe on the same table under the same load.
//                 Held to the indexed-read budget. If the scan and the probe ever converge, the index
//                 stopped being used; if the probe alone regresses, it is the pool, not the predicate.
//
// The table size is a fixture, not an accident: `prepare-db.ts` seeds `IDENTITY_BULK_USERS` (default
// 20 000) users and ANALYZEs, so the measured plan is the one a realistic table produces. A 50-row table
// would make every predicate instant and the whole scenario theatre.
//
//   npm run test:load:tokens
//   IDENTITY_BULK_USERS=20000 npm run test:load:db        # DATABASE_URL=…
//   k6 run -e IDENTITY_API_BASE_URL=http://localhost:3001 tests/load/admin-user-search.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    ADMIN_LOOKUP_P95_MS,
    ADMIN_SEARCH_P95_MS,
    BASE_URL,
    PEAK_VUS,
    SUMMARY_TREND_STATS,
    TOKENS,
    authHeaders,
    rampStages,
} from './lib/common.js';

// The admin principal's token: `public_metadata.scopes` carries `admin:users`, the only thing `ScopesGuard`
// accepts. One token, not a pool — admin traffic is a handful of operators, and the endpoint is not
// per-user state, so VU affinity buys nothing here.
const adminToken = TOKENS.admin;
const search = TOKENS.adminSearch;

const searchTrend = new Trend('identity_admin_search_duration', true);
const lookupTrend = new Trend('identity_admin_lookup_duration', true);

// Admin search is an operator action, not user traffic — a quarter of the peak is already far more
// concurrent admin searching than reality, and it keeps the scan load from dwarfing the indexed contrast.
const adminPeak = Math.max(1, Math.ceil(PEAK_VUS / 4));

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        search: {
            executor: 'ramping-vus',
            exec: 'searchPath',
            startVUs: 0,
            stages: rampStages(adminPeak),
            tags: { op: 'search' },
        },
        lookup: {
            executor: 'ramping-vus',
            exec: 'lookupPath',
            startVUs: 0,
            stages: rampStages(adminPeak),
            tags: { op: 'lookup' },
        },
    },
    thresholds: {
        'http_req_duration{operation:adminSearchMiss}': [`p(95)<${ADMIN_SEARCH_P95_MS}`],
        'http_req_duration{operation:adminSearchName}': [`p(95)<${ADMIN_SEARCH_P95_MS}`],
        'http_req_duration{operation:adminSearchHit}': [`p(95)<${ADMIN_SEARCH_P95_MS}`],
        'http_req_duration{operation:adminLookupById}': [`p(95)<${ADMIN_LOOKUP_P95_MS}`],
        'http_req_failed{op:search}': [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
        'http_req_failed{op:lookup}': ['rate<0.01'],
        'checks{op:search}': ['rate>0.99'],
        'checks{op:lookup}': ['rate>0.99'],
        dropped_iterations: ['count<1'],
    },
};

/** GET the admin list with one query-string filter. */
function adminList(query, operation) {
    return http.get(`${BASE_URL}/api/v1/admin/users?${query}`, {
        headers: authHeaders(adminToken),
        tags: { operation },
    });
}

/** Parse the `users` array from an admin-list response, or `null` if the body is not the expected shape. */
function usersOf(res) {
    if (res.status !== 200) {
        return null;
    }

    try {
        const body = res.json();

        return Array.isArray(body.users) ? body.users : null;
    } catch {
        return null;
    }
}

export function searchPath() {
    const miss = adminList(`email=${encodeURIComponent(search.emailMissNeedle)}`, 'adminSearchMiss');
    searchTrend.add(miss.timings.duration);
    check(miss, {
        // A zero-match search is a 200 with an EMPTY array — asserting `length === 0` is what proves the
        // predicate ran at all (a filter that was silently dropped would return the first 50 users here).
        'adminSearchMiss 200 with no matches': (r) => {
            const users = usersOf(r);

            return users !== null && users.length === 0;
        },
    });

    const hit = adminList(`email=${encodeURIComponent(search.emailHitNeedle)}`, 'adminSearchHit');
    searchTrend.add(hit.timings.duration);
    check(hit, {
        'adminSearchHit 200 with at least one match': (r) => {
            const users = usersOf(r);

            return users !== null && users.length >= 1;
        },
    });

    const byName = adminList(`name=${encodeURIComponent(search.nameNeedle)}`, 'adminSearchName');
    searchTrend.add(byName.timings.duration);
    check(byName, {
        'adminSearchName 200 with at least one match': (r) => {
            const users = usersOf(r);

            return users !== null && users.length >= 1;
        },
    });

    sleep(1);
}

export function lookupPath() {
    const res = adminList(`sub=${encodeURIComponent(search.exactUserId)}`, 'adminLookupById');
    lookupTrend.add(res.timings.duration);
    check(res, {
        'adminLookupById 200 with exactly one match': (r) => {
            const users = usersOf(r);

            return users !== null && users.length === 1 && users[0].sub === search.exactUserId;
        },
    });
    sleep(1);
}
