/**
 * U2 (FR-5/KTD-2) — provision the ONE `food:admin` observer.
 *
 * Creates a dedicated Clerk user, grants `food:admin` via `public_metadata` (the food guard reads scopes
 * from the verified token's `public_metadata`, so the grant MUST precede the token mint), mints a session
 * token, and verifies it against `/api/v1/foods/admin/queue` (200 = grant took effect). Writes `admin.json`
 * (the same `{ userId, sessionId, devJwt, cookie, jwt }` handle shape the collector refreshes and the
 * orchestrator tears down). This observer is deliberately OUTSIDE the VU pool so load traffic stays
 * "ordinary user" shaped.
 *
 * Env: CLERK_SECRET_KEY (required), FOOD_BASE_URL, FAPI, ORIGIN, OUT_DIR, ADMIN_SCOPE.
 * @sideEffect Creates + configures a Clerk user; writes admin.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SK = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'];
const FOOD_BASE_URL = (process.env['FOOD_BASE_URL'] ?? 'https://food-pr-59.commise.app').replace(/\/$/, '');
const FAPI = (process.env['FAPI'] ?? 'https://nice-fowl-6.clerk.accounts.dev').replace(/\/$/, '');
const ORIGIN = process.env['ORIGIN'] ?? 'https://sandbox.commise.app';
const BAPI = 'https://api.clerk.com/v1';
const OUT_DIR = process.env['OUT_DIR'] ?? '.';
const ADMIN_SCOPE = process.env['ADMIN_SCOPE'] ?? 'food:admin';

if (!SK) {
    throw new Error('CLERK_SECRET_KEY (or CLERK_SK) is required — the Clerk backend API secret.');
}

const bapi = (path, opts = {}) =>
    fetch(`${BAPI}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });

/** Best-effort teardown with retries; surfaces an explicit ORPHANED marker if it ultimately fails. */
async function deleteUser(userId) {
    if (!userId) {
        return;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const res = await bapi(`/users/${userId}`, { method: 'DELETE' });

            if (res.status === 200 || res.status === 404) {
                return;
            }
        } catch {
            // fall through to retry
        }

        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }

    console.error(`  !! ORPHANED USER ${userId} — teardown DELETE failed; delete it manually in Clerk.`);
}

async function main() {
    const stamp = `${Date.now()}`;

    // 1. Create the observer user.
    const uRes = await bapi('/users', {
        method: 'POST',
        body: JSON.stringify({
            email_address: [`loadtest-admin+${stamp}@example.com`],
            username: `loadtest_admin_${stamp}`,
            first_name: 'Load',
            last_name: 'Admin',
            password: `Pw-${stamp}-xZ!`,
        }),
    });
    // Parse defensively — a 201 with a truncated body must not throw before we can register teardown.
    const uBody = await uRes.json().catch(() => ({}));

    if (!uRes.ok) {
        throw new Error(`create admin user ${uRes.status}: ${JSON.stringify(uBody).slice(0, 200)}`);
    }

    const userId = uBody.id;

    if (!userId) {
        throw new Error(`create admin user returned ${uRes.status} but no user id — cannot manage/teardown it.`);
    }

    try {
        // 2. Grant the scope via public_metadata — BEFORE minting the token so it carries the scope.
        const mRes = await bapi(`/users/${userId}/metadata`, {
            method: 'PATCH',
            body: JSON.stringify({ public_metadata: { scopes: [ADMIN_SCOPE] } }),
        });

        if (!mRes.ok) {
            throw new Error(`grant scope ${mRes.status}: ${JSON.stringify(await mRes.json()).slice(0, 200)}`);
        }

        // 3. Sign in + mint a token (now carrying public_metadata.scopes).
        const stRes = await bapi('/sign_in_tokens', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
        const stBody = await stRes.json().catch(() => ({}));

        if (!stRes.ok || !stBody.token) {
            throw new Error(`sign_in_tokens ${stRes.status}: ${JSON.stringify(stBody).slice(0, 200)}`);
        }

        const ticket = stBody.token;

        const dbRes = await fetch(`${FAPI}/v1/dev_browser`, { method: 'POST', headers: { Origin: ORIGIN } });
        const devJwt = (await dbRes.json().catch(() => ({})))?.token ?? '';
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
            throw new Error(`no admin session: ${JSON.stringify(siBody).slice(0, 200)}`);
        }

        const tRes = await fetch(`${FAPI}/v1/client/sessions/${sessionId}/tokens?${q}`, {
            method: 'POST',
            headers: { Origin: ORIGIN, Cookie: cookie },
        });
        const tBody = await tRes.json().catch(() => ({}));
        const jwt = tBody.jwt;

        if (!tRes.ok || !jwt) {
            throw new Error(`session token ${tRes.status}: ${JSON.stringify(tBody).slice(0, 200)}`);
        }

        // 4. Verify the grant took effect end-to-end. Retry transient 503s (Fargate Spot restart / the
        //    AuthLoadShedder) so a healthy grant is not failed by an unrelated service blip; a 403 is a
        //    real scope failure and fails immediately.
        let status = 0;

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const check = await fetch(`${FOOD_BASE_URL}/api/v1/foods/admin/queue`, {
                headers: { Authorization: `Bearer ${jwt}` },
            });
            status = check.status;

            if (status === 200 || status === 403) {
                break;
            }

            await new Promise((r) => setTimeout(r, 3000)); // brief backoff on 5xx/transient
        }

        if (status === 403) {
            throw new Error(
                `admin token got 403 — the '${ADMIN_SCOPE}' scope did not take effect (is the Clerk session token configured to emit public_metadata?)`,
            );
        }

        if (status !== 200) {
            throw new Error(
                `admin verify got ${status} from /api/v1/foods/admin/queue after retries (service unavailable?).`,
            );
        }

        writeFileSync(
            join(OUT_DIR, 'admin.json'),
            `${JSON.stringify({ userId, sessionId, devJwt, cookie, jwt }, null, 2)}\n`,
        );
        console.log(
            `Observer ready (${ADMIN_SCOPE}); /api/v1/foods/admin/queue -> 200. Wrote ${join(OUT_DIR, 'admin.json')}.`,
        );
    } catch (err) {
        console.error(`Grant failed, deleting observer ${userId}: ${err?.message ?? err}`);
        await deleteUser(userId);

        throw err;
    }
}

await main();
