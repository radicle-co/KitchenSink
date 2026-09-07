/**
 * Provision the k6 credential pool: N persistent load users plus one admin, each holding a session token a
 * DEPLOYED stage will actually admit.
 *
 * ## Why this replaced `provision-pool.mjs`
 *
 * That file minted through Clerk's Backend API (`POST /sessions`, then a token on it) because that route
 * carries no per-IP rate limit. The tokens it produced carry no `azp`, and an `azp`-less token is admitted
 * only by `isNativeClientToken` — the `client_type: 'native'` claim the mobile app's own JWT template
 * mints, whose docstring is explicit that such a token is admitted because it PROVES it is native, "not
 * merely because it lacks an origin". Measured against the live `pr-91` stage: **401 from both food and
 * recipe**. The pool was unusable against every stage running the pattern guard, which is every stage.
 *
 * ## What it does instead, and how it pays the throttle only once
 *
 * It signs in through the FRONTEND API with `Origin` set to the stage's web origin, because that Origin is
 * what Clerk stamps as `azp` and `CLERK_AZP_PATTERN` is anchored against (ADR-0001/ADR-0033). That path IS
 * per-IP rate limited — the cost the backend shortcut existed to dodge — so the two halves are separated:
 *
 *   - `establishSession` is the throttled half. It runs ONCE per identity, SEQUENTIALLY, and its handle is
 *     persisted, so a second run signs in for nothing.
 *   - `remintFromSession` is not throttled. Every run re-mints from the stored handles.
 *
 * A stored handle that no longer works is not fatal: that name falls back to a fresh sign-in, so an
 * expired or revoked session degrades to the first-run cost rather than to a broken pool.
 *
 * ## What it writes
 *
 * `pool.json`, `tokens.json` and `admin.json`, in the shapes the k6 scripts already `open()` — the wire
 * contract with the scripts is deliberately unchanged, because the defect was the token's provenance and
 * nothing else. `handles.json` is new and is the sign-in savings; it holds session ids and dev-browser
 * JWTs, so it is written `0600` and must never be logged or committed.
 *
 * Env: `CLERK_SECRET_KEY` (find-or-create), `CLERK_PUBLISHABLE_KEY` (the FAPI host is decoded from it, so
 *   the instance can never drift from the keys), `POOL_ORIGIN` (the stage's web origin — the value that
 *   becomes `azp`), `FOOD_BASE_URL` (to verify the admin grant), `POOL_SIZE` (default 10), `EMAIL_DOMAIN`
 *   (default radcile.com), `ADMIN_SCOPE` (default food:admin), `OUT_DIR` (default `.`).
 *
 * Usage: `npm run provision:pool --workspace=packages/tools/loadtest`
 *
 * @sideEffect Creates or reuses Clerk users, signs in against the Frontend API, and writes four files.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { assertAzp, establishSession, remintFromSession } from '@kitchensink/e2e-fixtures';
import type { SessionHandle } from '@kitchensink/e2e-fixtures';

import { POOL_NAMES, partitionHandles, poolEmail, poolUserPayload } from './src/pool.js';
import { buildFoodTokenPool, buildIdentityTokenPool } from './src/tokenPool.js';

const BACKEND_API = 'https://api.clerk.com/v1';

/**
 * Spacing between consecutive Frontend API sign-ins.
 *
 * ⚠️ Not a guess dressed as a constant, and not a fix either: Clerk publishes no per-IP figure for the
 * sign-in endpoints, so this is a politeness interval that keeps a cold 10-user provision under a minute
 * while never issuing a burst. The REAL mitigation is that a warm run issues NO sign-ins at all.
 */
const SIGN_IN_SPACING_MS = 1_500;

/** How many times a failed find-or-create is retried against a 429 from the Backend API. */
const BACKEND_RETRIES = 4;

const secretKey = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'] ?? '';
const publishableKey = process.env['CLERK_PUBLISHABLE_KEY'] ?? '';
const origin = (process.env['POOL_ORIGIN'] ?? '').replace(/\/$/u, '');
const foodBaseUrl = (process.env['FOOD_BASE_URL'] ?? '').replace(/\/$/u, '');
const poolSize = Number(process.env['POOL_SIZE'] ?? 10);
const emailDomain = process.env['EMAIL_DOMAIN'] ?? 'radcile.com';
const adminScope = process.env['ADMIN_SCOPE'] ?? 'food:admin';
const outDir = process.env['OUT_DIR'] ?? '.';

/** Every missing input at once, so a cold setup is one round trip rather than four. */
const missing = [
    ['CLERK_SECRET_KEY', secretKey],
    ['CLERK_PUBLISHABLE_KEY', publishableKey],
    ['POOL_ORIGIN', origin],
    ['FOOD_BASE_URL', foodBaseUrl],
]
    .filter(([, value]) => value.length === 0)
    .map(([name]) => name);

if (missing.length > 0) {
    throw new Error(`missing required environment: ${missing.join(', ')}`);
}

if (poolSize > POOL_NAMES.length) {
    throw new Error(`POOL_SIZE ${poolSize} exceeds the ${POOL_NAMES.length} stable names — add more to POOL_NAMES.`);
}

/**
 * Call the Clerk Backend API, retrying a 429 with exponential backoff.
 *
 * @sideEffect Network.
 */
async function backend(path: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(`${BACKEND_API}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
                ...(init.headers ?? {}),
            },
        });

        if (response.status !== 429 || attempt >= BACKEND_RETRIES) {
            return response;
        }

        await delay(500 * 2 ** attempt);
    }
}

/**
 * Find the pool user for `name` by exact address, or create it. Idempotent across runs.
 *
 * @sideEffect Network; may create a Clerk user.
 */
async function findOrCreateUser(name: string): Promise<{ readonly id: string; readonly email: string }> {
    const email = poolEmail(name, emailDomain);
    const existing = await backend(`/users?email_address=${encodeURIComponent(email)}`);

    if (existing.ok) {
        const list = (await existing.json()) as readonly { readonly id: string }[];

        if (Array.isArray(list) && list.length > 0 && list[0]) {
            return { id: list[0].id, email };
        }
    }

    const created = await backend('/users', {
        method: 'POST',
        // The whole body is derived from the roster name — address, username and the instance-required
        // password together, so none of the three can be dropped or drift from the others.
        body: JSON.stringify(poolUserPayload(name, emailDomain)),
    });
    const body = (await created.json()) as { readonly id?: string };

    if (!created.ok || !body.id) {
        throw new Error(`create ${email} ${created.status}: ${JSON.stringify(body).slice(0, 200)}`);
    }

    return { id: body.id, email };
}

/** The persisted sign-in handles, keyed by roster name. Absent or unreadable is simply "none". */
function readHandles(path: string): Record<string, SessionHandle> {
    if (!existsSync(path)) {
        return {};
    }

    try {
        return JSON.parse(readFileSync(path, 'utf8')) as Record<string, SessionHandle>;
    } catch {
        // A corrupt handle file costs one cold provision; refusing to run would cost the whole load test.
        return {};
    }
}

/**
 * Mint a bearer for `name`, re-using a stored handle when there is one.
 *
 * @returns The credential and the handle that produced it, so a fresh sign-in is persisted for next time.
 * @sideEffect Network; may perform a throttled Frontend API sign-in.
 */
async function credentialFor(
    email: string,
    stored: SessionHandle | undefined,
): Promise<{ readonly jwt: string; readonly handle: SessionHandle }> {
    if (stored) {
        try {
            const reminted = await remintFromSession(stored);

            return { jwt: assertAzp(reminted.token, origin).token, handle: stored };
        } catch {
            // Expired, revoked, or minted against another origin. Fall through to a cold sign-in rather
            // than failing the pool: the cost is one throttled call, not a broken run.
        }
    }

    const handle = await establishSession({ email, publishableKey, origin });
    const credential = await remintFromSession(handle);

    return { jwt: assertAzp(credential.token, origin).token, handle };
}

/**
 * The four invalid credentials `authRejection` presents. Each must be REALLY invalid in its own way —
 * the scenario's value is that every one of them still answers 401 while the service is saturated.
 *
 * ⚠️ `expired` is a genuine token, not a forged one. A payload edited to move `exp` into the past breaks
 * the signature, so the service would reject it as a BAD SIGNATURE and the run would measure that path
 * twice under two names. A real token lives about sixty seconds, and the scenarios run minutes after
 * provisioning, so by the time it is presented it has genuinely expired.
 *
 * ⚠️ `wrongAzp` costs one extra throttled sign-in, because `azp` is stamped from the Origin at SIGN-IN;
 * re-minting from an existing handle cannot change it.
 *
 * @sideEffect Performs one Frontend API sign-in against an unauthorized origin.
 */
async function mintRejections(): Promise<{
    readonly badSignature: string;
    readonly expired: string;
    readonly wrongAzp: string;
    readonly malformed: string;
}> {
    const [sample] = members;

    if (!sample) {
        throw new Error('mintRejections: the pool produced no member to derive rejection tokens from');
    }

    // A structurally valid token whose signature does not verify: keep the header and payload, replace the
    // signature. Rotating one character would risk landing on the same byte.
    const [header, payload] = sample.jwt.split('.');
    const badSignature = `${header}.${payload}.aW52YWxpZC1zaWduYXR1cmU`;

    const wrongOriginHandle = await establishSession({
        email: poolEmail('alfa', emailDomain),
        publishableKey,
        origin: 'https://unauthorized.invalid',
    });
    const wrongAzp = (await remintFromSession(wrongOriginHandle)).token;

    return { badSignature, expired: sample.jwt, wrongAzp, malformed: 'not-a-jwt' };
}

const names: readonly string[] = POOL_NAMES.slice(0, poolSize);
const handlesPath = join(outDir, 'handles.json');
const handles = readHandles(handlesPath);
const { reuse, establish } = partitionHandles(handles, [...names, 'admin']);

console.log(
    `Provisioning ${names.length} pool users + 1 admin against ${origin} — ` +
        `${reuse.length} re-minting from a stored session, ${establish.length} signing in.`,
);

const members: { name: string; email: string; userId: string; jwt: string }[] = [];

// ⛔ SEQUENTIAL, on purpose. The old provisioner ran four at a time because the Backend API tolerates it;
// the Frontend API sign-in does not, and a burst is exactly what trips the per-IP cool-down that turns
// every subsequent name into a failure. Re-mints are cheap, so the warm path is fast regardless.
for (const name of [...names, 'admin']) {
    const user = await findOrCreateUser(name);

    if (name === 'admin') {
        // Grant BEFORE minting, so the token carries the scope in its signed `public_metadata`.
        const granted = await backend(`/users/${user.id}/metadata`, {
            method: 'PATCH',
            body: JSON.stringify({ public_metadata: { scopes: [adminScope] } }),
        });

        if (!granted.ok) {
            throw new Error(
                `grant ${adminScope} to ${user.email} ${granted.status}: ${(await granted.text()).slice(0, 200)}`,
            );
        }
    }

    const wasStored = handles[name] !== undefined;
    const { jwt, handle } = await credentialFor(user.email, handles[name]);

    handles[name] = handle;
    members.push({ name, email: user.email, userId: user.id, jwt });

    if (!wasStored) {
        await delay(SIGN_IN_SPACING_MS);
    }
}

const admin = members.find((member) => member.name === 'admin');
const pool = members.filter((member) => member.name !== 'admin');

if (!admin) {
    throw new Error('the admin identity was not provisioned');
}

// Verify the grant against a real admin route — a scope that did not take effect is a silent 403 later.
let verified = 0;

for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${foodBaseUrl}/api/v1/foods/admin/queue`, {
        headers: { Authorization: `Bearer ${admin.jwt}` },
    });

    verified = response.status;

    if (response.status === 200) {
        break;
    }

    if (response.status === 403) {
        throw new Error(`admin token 403 — '${adminScope}' scope did not take effect on ${admin.email}.`);
    }

    await delay(1_500);
}

// ⛔ THE SERVICE SCENARIOS OPEN THEIR OWN POOL FILES, in two different shapes, at INIT. Without them
// food's `authFlood` and identity's `sessionHotPath`/`authRejection` never start — they die on a Go
// `stat` error naming a path, which is exactly the regression
// `identity/tests/load/lib/common.js` documents surviving review because no CI job ran the tier.
// `k6TokenPoolShape.test.ts` derives the required keys from those scenarios' own source.
const bearers = pool.map((member) => member.jwt);

writeFileSync(join(outDir, 'food-tokens.json'), `${JSON.stringify(buildFoodTokenPool(bearers), null, 4)}\n`);
writeFileSync(
    join(outDir, 'identity-tokens.json'),
    `${JSON.stringify(buildIdentityTokenPool(bearers, await mintRejections()), null, 4)}\n`,
);
writeFileSync(join(outDir, 'pool.json'), `${JSON.stringify(pool, null, 4)}\n`);
writeFileSync(
    join(outDir, 'tokens.json'),
    `${JSON.stringify(
        pool.map((member) => member.jwt),
        null,
        4,
    )}\n`,
);
writeFileSync(join(outDir, 'admin.json'), `${JSON.stringify({ jwt: admin.jwt, userId: admin.userId }, null, 4)}\n`);
writeFileSync(handlesPath, `${JSON.stringify(handles, null, 4)}\n`);
chmodSync(handlesPath, 0o600);

console.log(
    `Pool ready: ${pool.length} users, admin verified=${verified}. ` +
        `Wrote pool.json / tokens.json / admin.json to ${outDir}; handles.json (0600) saves the next run's sign-ins.`,
);
