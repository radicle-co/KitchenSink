/**
 * Persistent, Backend-API pool provisioner (recommended over auth/provision-users.mjs for local runs).
 *
 * WHY: the FAPI ticket-exchange flow (dev_browser → sign_ins) is per-IP rate-limited, so minting a pool
 * from one machine trips a multi-minute cool-down. Clerk's BACKEND API can create a session + mint a
 * session token directly (POST /sessions, POST /sessions/{id}/tokens) — no FAPI, no per-IP throttle. The
 * resulting token has no `azp`, which the food guard accepts (Clerk's verifyToken only checks `azp` when
 * present). Confirmed: GET /v1/foods/search → 200 with such a token.
 *
 * PERSISTENT: users have STABLE emails (test-{name}@radcile.com) and are created-or-REUSED, never torn
 * down by a load run — so the pool survives across runs (only `npm run sweep` deletes them). Each run
 * (re)creates fresh backend sessions + tokens (cheap, unthrottled). Writes pool.json + admin.json.
 *
 * Env: CLERK_SECRET_KEY (required), POOL_SIZE (default 10), EMAIL_DOMAIN (default radcile.com),
 *   ADMIN_SCOPE (default food:admin), FOOD_BASE_URL (to verify the admin grant), OUT_DIR.
 * @sideEffect Creates/reuses Clerk users + sessions; writes pool.json/admin.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const SK = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'];
const BAPI = 'https://api.clerk.com/v1';
const POOL_SIZE = Number(process.env['POOL_SIZE'] ?? 10);
const EMAIL_DOMAIN = process.env['EMAIL_DOMAIN'] ?? 'radcile.com';
const ADMIN_SCOPE = process.env['ADMIN_SCOPE'] ?? 'food:admin';
const FOOD_BASE_URL = (process.env['FOOD_BASE_URL'] ?? 'https://food-pr-59.commise.app').replace(/\/$/, '');
const OUT_DIR = process.env['OUT_DIR'] ?? '.';
const CONCURRENCY = Number(process.env['CONCURRENCY'] ?? 4);

// Stable names → stable emails, so the pool is deterministic + reusable across runs.
const NAMES = [
    'alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett',
    'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango',
];

if (!SK) {
    throw new Error('CLERK_SECRET_KEY (or CLERK_SK) is required — the Clerk backend API secret.');
}

if (POOL_SIZE > NAMES.length) {
    throw new Error(`POOL_SIZE ${POOL_SIZE} exceeds the ${NAMES.length} stable names — add more to NAMES.`);
}

async function bapi(path, opts = {}) {
    for (let attempt = 0; ; attempt += 1) {
        const res = await fetch(`${BAPI}${path}`, {
            ...opts,
            headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });

        if (res.status !== 429 || attempt >= 4) {
            return res;
        }

        await delay(500 * 2 ** attempt); // backend limits are generous, but be polite
    }
}

/** Find a user by exact email, or create one. Idempotent → reused across runs, never duplicated. */
async function findOrCreateUser(name) {
    const email = `test-${name}@${EMAIL_DOMAIN}`;
    const existing = await bapi(`/users?email_address=${encodeURIComponent(email)}`);

    if (existing.ok) {
        const list = await existing.json();

        if (Array.isArray(list) && list.length > 0) {
            return { id: list[0].id, email, reused: true };
        }
    }

    const res = await bapi('/users', {
        method: 'POST',
        body: JSON.stringify({
            email_address: [email],
            username: `test_${name}`,
            first_name: 'Load',
            last_name: name,
            password: `PoolPw-${name}-xZ9kQ2`,
        }),
    });
    const body = await res.json();

    if (!res.ok) {
        throw new Error(`create ${email} ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    }

    return { id: body.id, email, reused: false };
}

/** Create a fresh backend session for a user and mint its first token. */
async function freshSession(userId) {
    const sRes = await bapi('/sessions', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
    const sBody = await sRes.json();

    if (!sRes.ok || !sBody.id) {
        throw new Error(`create session for ${userId} ${sRes.status}: ${JSON.stringify(sBody).slice(0, 200)}`);
    }

    const tRes = await bapi(`/sessions/${sBody.id}/tokens`, { method: 'POST' });
    const tBody = await tRes.json();

    if (!tRes.ok || !tBody.jwt) {
        throw new Error(`mint token for session ${sBody.id} ${tRes.status}: ${JSON.stringify(tBody).slice(0, 200)}`);
    }

    return { sessionId: sBody.id, jwt: tBody.jwt };
}

/** Run tasks with bounded concurrency; every task settles (a throw doesn't abort siblings). */
async function mapSettled(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;

    async function run() {
        while (next < items.length) {
            const i = next++;

            try {
                results[i] = { ok: true, value: await worker(items[i], i) };
            } catch (error) {
                results[i] = { ok: false, error };
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));

    return results;
}

async function provisionUser(name) {
    const user = await findOrCreateUser(name);
    const session = await freshSession(user.id);

    return { name, email: user.email, userId: user.id, sessionId: session.sessionId, jwt: session.jwt, reused: user.reused };
}

async function provisionAdmin() {
    const user = await findOrCreateUser('admin');
    // Grant the scope BEFORE minting the token so the token carries public_metadata.scopes.
    const mRes = await bapi(`/users/${user.id}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ public_metadata: { scopes: [ADMIN_SCOPE] } }),
    });

    if (!mRes.ok) {
        throw new Error(`grant ${ADMIN_SCOPE} to ${user.email} ${mRes.status}: ${(await mRes.text()).slice(0, 200)}`);
    }

    const session = await freshSession(user.id);

    // Verify the grant took effect against a real admin route.
    let verified = 0;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await fetch(`${FOOD_BASE_URL}/v1/foods/admin/queue`, {
            headers: { Authorization: `Bearer ${session.jwt}` },
        });
        verified = res.status;

        if (res.status === 200) {
            break;
        }

        if (res.status === 403) {
            throw new Error(`admin token 403 — '${ADMIN_SCOPE}' scope did not take effect on ${user.email}.`);
        }

        await delay(1500);
    }

    return { name: 'admin', email: user.email, userId: user.id, sessionId: session.sessionId, jwt: session.jwt, verified };
}

const names = NAMES.slice(0, POOL_SIZE);
console.log(`Provisioning ${POOL_SIZE} persistent pool users + 1 admin via the Backend API (no FAPI)…`);

const [settled, admin] = await Promise.all([mapSettled(names, CONCURRENCY, provisionUser), provisionAdmin()]);
const failures = settled.filter((r) => !r.ok);

if (failures.length > 0) {
    failures.slice(0, 5).forEach((f) => console.error(`  - ${f.error?.message ?? f.error}`));
    throw new Error(`${failures.length}/${POOL_SIZE} pool users failed. Persistent users are NOT torn down — re-run to fill gaps.`);
}

const pool = settled.map((r) => r.value);
const reused = pool.filter((p) => p.reused).length;

writeFileSync(join(OUT_DIR, 'pool.json'), `${JSON.stringify(pool.map(({ reused: _r, ...rest }) => rest), null, 2)}\n`);
writeFileSync(join(OUT_DIR, 'tokens.json'), `${JSON.stringify(pool.map((p) => p.jwt), null, 2)}\n`);
writeFileSync(join(OUT_DIR, 'admin.json'), `${JSON.stringify({ jwt: admin.jwt, sessionId: admin.sessionId, userId: admin.userId }, null, 2)}\n`);

console.log(`Pool ready: ${pool.length} users (${reused} reused, ${pool.length - reused} created), admin verified=${admin.verified}.`);
console.log(`Wrote pool.json / tokens.json / admin.json to ${OUT_DIR}. Persistent — run \`npm run sweep\` to delete.`);
