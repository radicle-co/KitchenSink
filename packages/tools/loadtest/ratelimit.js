/**
 * U6 — USDA rate-limit burst. Floods the food API with UNIQUE (cache-missing) add-by-name requests so the
 * worker's USDA rolling window reaches its cap, driving the throttle behavior we want to prove under load:
 * the queue STALLS (worker pauses at 90% of the cap) and then RESUMES once the window clears.
 *
 * Run against a preview deployed with a LOW cap + SHORT window (CDK context `foodSourceRateLimitPerHour` /
 * `foodSourceWindowSeconds`); the stall→resume is OBSERVED server-side by observe/collect-metrics.mjs (admin
 * `/metrics` `sources[usda].paused`/utilization + `/queue` depth) and correlated by ratelimit.mjs. This
 * script only GENERATES the burst — a fixed number of distinct enqueues as fast as the arrival rate allows.
 *
 * Env: POOL_FILE, FOOD_BASE_URL, CLERK_SECRET_KEY (backend token refresh), BURST_COUNT, BURST_RATE,
 *   RUN_TAG (unique-name namespace so reruns never collide with cached foods).
 */
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const BASE_URL = (__ENV.FOOD_BASE_URL || '').replace(/\/$/, '');
const POOL_FILE = __ENV.POOL_FILE || './pool.json';
const CLERK_SK = __ENV.CLERK_SECRET_KEY || '';
const BAPI = 'https://api.clerk.com/v1';
const BURST_COUNT = Number(__ENV.BURST_COUNT || 60);
const BURST_RATE = Number(__ENV.BURST_RATE || 20);
const RUN_TAG = __ENV.RUN_TAG || 'rl';

if (!BASE_URL) {
    // ⛔ No target, no run — never a green run against a default host that no longer exists.
    throw new Error(
        'FOOD_BASE_URL is required — resolve it with `node printPublicOrigin.mjs food <stage> <apex>`. ' +
            'It used to default to a typed host that stopped resolving when that PR closed.',
    );
}

if (!CLERK_SK) {
    // Backend token refresh needs the secret; without it every mint 401s and the food adds would look like
    // "enqueue failures" rather than a config error. Fail fast at init.
    throw new Error('CLERK_SECRET_KEY is required (backend token refresh) — pass it in the run env.');
}

const pool = new SharedArray('pool', () => {
    const parsed = JSON.parse(open(POOL_FILE));
    const list = Array.isArray(parsed) ? parsed : parsed.pool;

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Pool ${POOL_FILE} is empty — run \`npm run provision:pool\` first`);
    }

    return list;
});

const enqueued = new Counter('food_burst_enqueued');
const enqueueFail = new Counter('food_burst_enqueue_fail');

export const options = {
    scenarios: {
        burst: {
            executor: 'shared-iterations',
            iterations: BURST_COUNT,
            vus: Math.min(BURST_RATE, BURST_COUNT),
            maxDuration: '2m',
        },
    },
};

let handle = null;
let vuToken = null;
let vuMintedAt = 0;

// Cache the backend token per VU and refresh only near expiry — a big burst (>1000 iters) must not mint a
// fresh token on every add.
function token() {
    // __VU is 1-based — subtract 1 so VU 1 maps to pool[0] (matches journey.js's mapping).
    if (!handle) handle = pool[(__VU - 1) % pool.length];

    if (vuToken && Date.now() - vuMintedAt < 40_000) {
        return vuToken;
    }

    const res = http.post(`${BAPI}/sessions/${handle.sessionId}/tokens`, null, {
        headers: { Authorization: `Bearer ${CLERK_SK}`, 'Content-Type': 'application/json' },
    });

    if (res.status === 200) {
        vuToken = res.json('jwt');
        vuMintedAt = Date.now();
    }

    return vuToken;
}

export default function () {
    const jwt = token();

    if (!jwt) {
        // Token mint failed (bad/missing CLERK_SECRET_KEY, expired session). Record the failure instead of
        // sending `Bearer null` — which would 401 and inflate the enqueue-fail count, masking the real cause.
        enqueueFail.add(1);
        check(null, { 'burst token minted': () => false });

        return;
    }

    // Unique per (tag, VU, iter) → always cache-missing → forces a real USDA search that charges the window.
    const name = `zzq ${RUN_TAG} ${__VU} ${__ITER} nonfood`;
    const res = http.post(`${BASE_URL}/api/v1/foods`, JSON.stringify({ name }), {
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        tags: { step: 'burst-add' },
    });
    const ok = check(res, { 'burst add 202': (r) => r.status === 202 });

    if (ok) {
        enqueued.add(1);
    } else {
        enqueueFail.add(1);
    }
}
