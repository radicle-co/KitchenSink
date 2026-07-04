/**
 * U1 (FR-3) — distinct-user token provisioner for the food-API load test.
 *
 * Mints a pool of N real Clerk test users in the sandbox instance and, for each, a session JWT the food
 * service accepts (carries `sub` + `azp = ORIGIN`, verified networklessly by `FoodAuthGuard`). Writes:
 *   - pool.json   : `[{ userId, sessionId, devJwt, cookie, jwt }, ...]` — what journey.js loads; the
 *                   devJwt/cookie/sessionId let each VU refresh its own ~60s token in-run, and userId is
 *                   the teardown handle.
 *   - tokens.json : `[jwt, ...]` — convenience for ad-hoc curl checks.
 *
 * ROBUSTNESS INVARIANTS (from an adversarial review — do not regress):
 *   - Every created Clerk user is registered for teardown the INSTANT it is created, so a later-step
 *     failure never orphans it.
 *   - A partial failure deletes every user created so far and exits non-zero — the sandbox never
 *     accumulates orphaned `loadtest+…` users across flaky runs.
 *   - Clerk 429s are retried with backoff (bounded concurrency still hammers create/sign-in endpoints).
 *
 * Env: CLERK_SECRET_KEY (backend API sk_test_…, required), FAPI, ORIGIN, POOL_SIZE, OUT_DIR, CONCURRENCY.
 * @sideEffect Creates Clerk users; writes token files to disk.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const SK = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'];
const FAPI = (process.env['FAPI'] ?? 'https://nice-fowl-6.clerk.accounts.dev').replace(/\/$/, '');
const ORIGIN = process.env['ORIGIN'] ?? 'https://sandbox.commise.app';
const BAPI = 'https://api.clerk.com/v1';
const POOL_SIZE = Number(process.env['POOL_SIZE'] ?? 20);
const OUT_DIR = process.env['OUT_DIR'] ?? '.';
const CONCURRENCY = Number(process.env['CONCURRENCY'] ?? 5);
const MAX_RETRIES = Number(process.env['MAX_RETRIES'] ?? 4);

// NB: no module-level SK check. `mintSessionToken` (imported by the collector) authenticates via the
// session cookie/FAPI, NOT the backend secret — so importing this module must not require CLERK_SECRET_KEY.
// The secret is only needed to PROVISION, so main() checks it.

/** userIds registered for teardown the instant they are created (so a mid-flow failure never orphans). */
const created = [];

/** fetch with bounded exponential backoff on 429 (Clerk rate limits). */
async function retryingFetch(url, opts, label) {
    for (let attempt = 0; ; attempt += 1) {
        const res = await fetch(url, opts);

        if (res.status !== 429 || attempt >= MAX_RETRIES) {
            return res;
        }

        const retryAfterMs = Number(res.headers.get('retry-after') || 0) * 1000 || 500 * 2 ** attempt;
        console.warn(`  429 on ${label} — retry ${attempt + 1}/${MAX_RETRIES} in ${retryAfterMs}ms`);
        await delay(retryAfterMs);
    }
}

const bapi = (path, opts = {}) =>
    retryingFetch(
        `${BAPI}${path}`,
        {
            ...opts,
            headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        },
        `BAPI ${opts.method ?? 'GET'} ${path}`,
    );

/** Mint one user + session JWT via the create-user -> sign-in-token -> FAPI ticket exchange flow. */
async function provisionOne(index) {
    const stamp = `${Date.now()}${index}`;
    const email = `loadtest+${stamp}@example.com`;

    const uRes = await bapi('/users', {
        method: 'POST',
        body: JSON.stringify({
            email_address: [email],
            username: `loadtest_${stamp}`,
            first_name: 'Load',
            last_name: 'Test',
            password: `Pw-${stamp}-xZ!`,
        }),
    });
    const uBody = await uRes.json();

    if (!uRes.ok) {
        throw new Error(`create user ${uRes.status}: ${JSON.stringify(uBody).slice(0, 200)}`);
    }

    const userId = uBody.id;
    created.push(userId); // register for teardown BEFORE any further step can throw

    const stRes = await bapi('/sign_in_tokens', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
    const stBody = await stRes.json();

    if (!stRes.ok) {
        throw new Error(`sign_in_tokens ${stRes.status}: ${JSON.stringify(stBody).slice(0, 200)}`);
    }

    const ticket = stBody.token;

    // Dev instances need a dev-browser handle before the ticket sign-in. Origin = ORIGIN so `azp` matches.
    const dbRes = await retryingFetch(`${FAPI}/v1/dev_browser`, { method: 'POST', headers: { Origin: ORIGIN } }, 'FAPI dev_browser');
    const dbBody = await dbRes.json().catch(() => ({}));
    const devJwt = dbBody?.token ?? dbBody?.id ?? '';
    const q = `__clerk_db_jwt=${encodeURIComponent(devJwt)}`;

    const siRes = await retryingFetch(
        `${FAPI}/v1/client/sign_ins?${q}`,
        {
            method: 'POST',
            headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ strategy: 'ticket', ticket }).toString(),
        },
        'FAPI sign_ins',
    );
    const siBody = await siRes.json();
    const cookie = siRes.headers.get('set-cookie') ?? '';
    const sessionId = siBody?.response?.created_session_id ?? siBody?.client?.sessions?.[0]?.id;

    if (!sessionId) {
        throw new Error(`no session: ${JSON.stringify(siBody).slice(0, 300)}`);
    }

    const jwt = await mintSessionToken(sessionId, devJwt, cookie);

    return { userId, sessionId, devJwt, cookie, jwt };
}

/** Mint (or refresh) a session JWT for an existing session. Exported for reuse by run.mjs (U5). */
export async function mintSessionToken(sessionId, devJwt, cookie) {
    const q = `__clerk_db_jwt=${encodeURIComponent(devJwt)}`;
    const tokRes = await retryingFetch(
        `${FAPI}/v1/client/sessions/${sessionId}/tokens?${q}`,
        { method: 'POST', headers: { Origin: ORIGIN, Cookie: cookie } },
        'FAPI session token',
    );
    const tokBody = await tokRes.json();

    if (!tokBody?.jwt) {
        throw new Error(`no jwt for session ${sessionId}: ${JSON.stringify(tokBody).slice(0, 200)}`);
    }

    return tokBody.jwt;
}

/** Delete every user created so far (best-effort teardown on failure). */
async function teardownCreated() {
    for (const userId of created) {
        try {
            const res = await bapi(`/users/${userId}`, { method: 'DELETE' });
            console.warn(`  cleanup DELETE /users/${userId} -> ${res.status}`);
        } catch (err) {
            console.warn(`  cleanup DELETE /users/${userId} FAILED: ${err?.message ?? err}`);
        }
    }
}

/** Run N workers with bounded concurrency; every worker settles (no sibling is aborted by a throw). */
async function mapSettled(count, limit, worker) {
    const results = new Array(count);
    let next = 0;

    async function run() {
        while (next < count) {
            const i = next++;

            try {
                results[i] = { ok: true, value: await worker(i) };
            } catch (error) {
                results[i] = { ok: false, error };
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, count) }, run));

    return results;
}

async function main() {
    if (!SK) {
        throw new Error('CLERK_SECRET_KEY (or CLERK_SK) is required — the Clerk backend API secret.');
    }

    const t0 = Date.now();
    console.log(`Provisioning ${POOL_SIZE} users against ${FAPI} (azp=${ORIGIN})…`);

    const settled = await mapSettled(POOL_SIZE, CONCURRENCY, provisionOne);
    const failures = settled.filter((r) => !r.ok);

    if (failures.length > 0) {
        console.error(`\n${failures.length}/${POOL_SIZE} users failed to provision:`);
        failures.slice(0, 5).forEach((f) => console.error(`  - ${f.error?.message ?? f.error}`));
        console.error(`Rolling back the ${created.length} users created so far so none are orphaned…`);
        await teardownCreated();

        throw new Error('Provisioning failed — rolled back. Fix the cause (often Clerk rate limits) and retry.');
    }

    const pool = settled.map((r) => r.value);
    const tokens = pool.map((entry) => entry.jwt);

    writeFileSync(join(OUT_DIR, 'pool.json'), `${JSON.stringify(pool, null, 2)}\n`);
    writeFileSync(join(OUT_DIR, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);

    console.log(`Wrote ${pool.length} users to ${join(OUT_DIR, 'pool.json')} in ${Date.now() - t0}ms.`);
    console.log('Reminder: session JWTs are ~60s-lived — journey.js refreshes each VU token in-run.');
}

// Only provision when run directly — importing this module (e.g. for `mintSessionToken`) must not
// kick off a full pool provision.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
