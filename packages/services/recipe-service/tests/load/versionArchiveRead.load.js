// Version-archive-read load scenario (W8-a.7).
//
// @loadTier substrate-bound — its subject is a state no API can produce — the recipe_versions row DELIBERATELY absent while S3 holds the snapshot
//
// Load-tests the READ side of the transparent S3 version-archive fallback: `GET
// /api/v1/recipes/{id}/versions/{n}` for a version evicted past the DB retention window, whose snapshot
// exists ONLY in the S3 archive (never in `recipe_versions`). The endpoint reads it back from S3 and
// returns it in the SAME shape a DB row would — the user never sees S3. Contrast with
// saveUnderArchive.load.js, which measures the WRITE side (a save must return without waiting on the
// archive write); this measures the READ side (a version GET that always misses the DB and falls back).
//
// Fixture: run tests/load/prepareVersionArchiveFixture.ts FIRST (via `npx tsx`, since k6 scripts can
// only import k6's built-in modules — see lib/common.js's docstring — and this fixture needs direct
// Postgres + S3 access). It is idempotent (fixed ids) and seeds the recipe this script's
// ARCHIVE_FIXTURE_RECIPE_ID (lib/common.js) addresses; mirrors
// tests/e2e/versionArchiveFallback.e2e.test.ts's setup (create → prune the DB row → PUT to the S3
// archive bucket).
//
//   DATABASE_URL=postgres://... npx tsx tests/load/prepareVersionArchiveFixture.ts
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/versionArchiveRead.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    authHeaders,
    rampStages,
    PEAK_VUS,
    ARCHIVE_FIXTURE_RECIPE_ID,
    VERSION_ARCHIVE_READ_P95_MS,
} from './lib/common.js';

const archiveReadTrend = new Trend('recipe_version_archive_read_duration', true);

export const options = {
    scenarios: {
        version_archive_read: {
            executor: 'ramping-vus',
            exec: 'archiveReadPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'version-archive-read' },
        },
    },
    thresholds: {
        // W8-a.7: the S3 fallback read must stay reasonably fast, even though — unlike a plain DB row
        // read (SC009_P95_MS's 500ms) — it costs a network round trip to S3 plus a JSON parse. See
        // VERSION_ARCHIVE_READ_P95_MS's doc (lib/common.js) for the budget's reasoning.
        'http_req_duration{operation:getArchivedVersion}': [`p(95)<${VERSION_ARCHIVE_READ_P95_MS}`],
        http_req_failed: ['rate<0.01'],
    },
};

export function archiveReadPath() {
    const res = http.get(`${BASE_URL}/api/v1/recipes/${ARCHIVE_FIXTURE_RECIPE_ID}/versions/1`, {
        headers: authHeaders(),
        tags: { operation: 'getArchivedVersion' },
    });
    archiveReadTrend.add(res.timings.duration);
    check(res, {
        'getArchivedVersion 200': (r) => r.status === 200,
        'served the archived version (versionNumber 1)': (r) => {
            try {
                return r.json('versionNumber') === 1;
            } catch {
                return false;
            }
        },
    });
    sleep(1);
}
