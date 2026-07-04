/**
 * U1 (FR-3) — distinct-user token provisioner for the food-API load test.
 *
 * Mints a pool of N real Clerk test users in the sandbox instance and, for each, a session JWT the food
 * service accepts (carries `sub` + `azp = ORIGIN`, verified networklessly by `FoodAuthGuard`). Writes:
 *   - tokens.json : `[jwt, ...]`            — what journey.js loads (VU i -> token i)
 *   - pool.json   : `[{ userId, sessionId, devJwt, cookie, jwt }, ...]` — refresh + teardown handles (U5)
 *
 * Session JWTs are ~60s-lived, so run this immediately before the k6 run; run.mjs (U5) refreshes the
 * pool (a single `POST /sessions/{id}/tokens` per user per ~minute) and deletes the users at teardown.
 *
 * Env: CLERK_SECRET_KEY (backend API sk_test_…, required), FAPI, ORIGIN, POOL_SIZE, OUT_DIR, CONCURRENCY.
 * @sideEffect Creates Clerk users; writes token files to disk.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SK = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'];
const FAPI = (process.env['FAPI'] ?? 'https://nice-fowl-6.clerk.accounts.dev').replace(/\/$/, '');
const ORIGIN = process.env['ORIGIN'] ?? 'https://sandbox.commise.app';
const BAPI = 'https://api.clerk.com/v1';
const POOL_SIZE = Number(process.env['POOL_SIZE'] ?? 20);
const OUT_DIR = process.env['OUT_DIR'] ?? '.';
const CONCURRENCY = Number(process.env['CONCURRENCY'] ?? 5);

if (!SK) {
    throw new Error('CLERK_SECRET_KEY (or CLERK_SK) is required — the Clerk backend API secret.');
}

const bapi = (path, opts = {}) =>
    fetch(`${BAPI}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });

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

    const stRes = await bapi('/sign_in_tokens', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
    const stBody = await stRes.json();

    if (!stRes.ok) {
        throw new Error(`sign_in_tokens ${stRes.status}: ${JSON.stringify(stBody).slice(0, 200)}`);
    }

    const ticket = stBody.token;

    // Dev instances need a dev-browser handle before the ticket sign-in. Origin = ORIGIN so `azp` matches.
    const dbRes = await fetch(`${FAPI}/v1/dev_browser`, { method: 'POST', headers: { Origin: ORIGIN } });
    const dbBody = await dbRes.json().catch(() => ({}));
    const devJwt = dbBody?.token ?? dbBody?.id ?? '';
    const q = `__clerk_db_jwt=${encodeURIComponent(devJwt)}`;

    const siRes = await fetch(`${FAPI}/v1/client/sign_ins?${q}`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ strategy: 'ticket', ticket }).toString(),
    });
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
    const tokRes = await fetch(`${FAPI}/v1/client/sessions/${sessionId}/tokens?${q}`, {
        method: 'POST',
        headers: { Origin: ORIGIN, Cookie: cookie },
    });
    const tokBody = await tokRes.json();

    if (!tokBody?.jwt) {
        throw new Error(`no jwt for session ${sessionId}: ${JSON.stringify(tokBody).slice(0, 200)}`);
    }

    return tokBody.jwt;
}

/** Run `tasks` with bounded concurrency, preserving input order in the results. */
async function mapWithConcurrency(count, limit, worker) {
    const results = new Array(count);
    let next = 0;

    async function run() {
        while (next < count) {
            const i = next++;
            results[i] = await worker(i);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, count) }, run));

    return results;
}

async function main() {
    const t0 = Date.now();
    console.log(`Provisioning ${POOL_SIZE} users against ${FAPI} (azp=${ORIGIN})…`);

    const pool = await mapWithConcurrency(POOL_SIZE, CONCURRENCY, provisionOne);
    const tokens = pool.map((entry) => entry.jwt);

    writeFileSync(join(OUT_DIR, 'pool.json'), `${JSON.stringify(pool, null, 2)}\n`);
    writeFileSync(join(OUT_DIR, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);

    console.log(`Wrote ${tokens.length} tokens to ${join(OUT_DIR, 'tokens.json')} in ${Date.now() - t0}ms.`);
    console.log('Reminder: session JWTs are ~60s-lived — start k6 now; run.mjs refreshes the pool.');
}

await main();
