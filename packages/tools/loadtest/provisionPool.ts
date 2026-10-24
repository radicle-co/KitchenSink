/**
 * Lease the k6 credential pool: N VU slots plus the admin slot of the FIXED test pool, each holding a session
 * token a DEPLOYED stage will actually admit.
 *
 * ## ⛔ It creates nobody (owner ruling 2026-09-13)
 *
 * > "We should have a pool of test users for clerk so that we don't need to create ones"
 *
 * This used to find-or-create its users through the Backend API and PATCH the admin's `food:admin` scope on
 * every run. Both writes now belong to `poolAdmin` alone, run out of band by the owner. Here every slot is
 * LEASED (`@kitchensink/e2e-fixtures/lease`): resolved from the committed roster, refused unless `poolAdmin`
 * marked it and the webhook gave it an `external_id`, then signed in. An unprovisioned pool FAILS this step —
 * which the workflow turns red on a live sandbox — rather than being quietly repaired by the run.
 *
 * ## Why the Frontend API, and how it pays the throttle only once
 *
 * `provision-pool.mjs` minted through the Backend API's `POST /sessions`, whose tokens carry no `azp` and
 * answered 401 from both food and recipe on `pr-91`. A Frontend API sign-in stamps `azp` from `Origin` (the
 * stage's web origin, which `CLERK_AZP_PATTERN` is anchored against — ADR-0033), but it is per-IP throttled. So
 * sign-in and mint are separate: `leaseSession` is the throttled half, run once per slot, SEQUENTIALLY; its
 * handle is persisted, and every later run re-mints from it (`remintFromSession`, not throttled). A stored
 * handle that no longer works falls back to a fresh lease rather than breaking the pool.
 *
 * ## What it writes
 *
 * `pool.json`, `tokens.json`, `admin.json`, `food-tokens.json`, `identity-tokens.json` and `handles.json`, in the
 * shapes the k6 scripts `open()`. `pool.json` and `admin.json` also carry each slot's `sessionId` and `devJwt`,
 * which is what the legacy food journey and its collector re-mint from. Every file holds live credentials:
 * gitignored, and `handles.json` is written `0600`.
 *
 * Env: `CLERK_SECRET_KEY` (roster lookup and sign-in tickets), `CLERK_PUBLISHABLE_KEY` (the FAPI host is decoded
 * from it), `POOL_ORIGIN` (the stage's web origin — the value that becomes `azp`), `FOOD_BASE_URL` (to verify the
 * admin grant took effect), `POOL_SIZE` (default 10, at most the roster's VU lanes), `OUT_DIR` (default `.`).
 *
 * Usage: `npm run provision:pool --workspace=packages/tools/loadtest`
 *
 * @sideEffect Looks up pool users, signs in against the Frontend API, and writes six files.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { assertAzp, remintFromSession } from '@kitchensink/e2e-fixtures';
import type { SessionHandle } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseSession, resolvePoolUser } from '@kitchensink/e2e-fixtures/lease';
import { k6VuSlots, slotFor, type PoolSlot } from '@kitchensink/e2e-fixtures/testPool';

import { partitionHandles } from './src/pool.js';
import { buildFoodTokenPool, buildIdentityTokenPool } from './src/tokenPool.js';

const secretKey = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'] ?? '';
const publishableKey = process.env['CLERK_PUBLISHABLE_KEY'] ?? '';
const origin = (process.env['POOL_ORIGIN'] ?? '').replace(/\/$/u, '');
const foodBaseUrl = (process.env['FOOD_BASE_URL'] ?? '').replace(/\/$/u, '');
const poolSize = Number(process.env['POOL_SIZE'] ?? 10);
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

const port = clerkLeasePort(secretKey);
// Throws when POOL_SIZE exceeds the roster's VU lanes — the fix is a roster lane plus poolAdmin, never a user
// minted here.
const slots: readonly PoolSlot[] = [...k6VuSlots(poolSize), slotFor('k6', 'admin')];

/** The persisted sign-in handles, keyed by slot id. Absent or unreadable is simply "none". */
function readHandles(path: string): Record<string, SessionHandle> {
    if (!existsSync(path)) {
        return {};
    }

    try {
        return JSON.parse(readFileSync(path, 'utf8')) as Record<string, SessionHandle>;
    } catch (error) {
        // A corrupt handle file costs one cold provision; refusing to run would cost the whole load test. Said out
        // loud, because it silently turns a warm run into N throttled sign-ins. The parse error quotes no content.
        console.error(
            `${new Date().toISOString()} ${path} is unreadable (${error instanceof Error ? error.name : 'error'}) — every identity will sign in`,
        );

        return {};
    }
}

/**
 * Mint a bearer for a slot, re-using a stored handle when there is one.
 *
 * @returns The credential and the handle that produced it, so a fresh sign-in is persisted for next time.
 * @sideEffect Network; may perform a throttled Frontend API sign-in.
 */
async function credentialFor(
    slot: PoolSlot,
    stored: SessionHandle | undefined,
): Promise<{ readonly jwt: string; readonly handle: SessionHandle }> {
    if (stored) {
        try {
            const reminted = await remintFromSession(stored);

            return { jwt: assertAzp(reminted.token, origin).token, handle: stored };
        } catch (error) {
            // Expired, revoked, or minted against another origin. Fall through to a fresh lease rather than
            // failing the pool: the cost is one throttled call, not a broken run — but NAMED, because an
            // unexplained cold sign-in is exactly what a throttled pool looks like from outside. Both messages
            // are credential-free by construction (`describeClerkRefusal`, `assertAzp`).
            console.error(
                `${new Date().toISOString()} ${slot.email}: stored session unusable, signing in — ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    const { handle } = await leaseSession({ slot, publishableKey, origin, port });
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
async function mintRejections(sampleJwt: string): Promise<{
    readonly badSignature: string;
    readonly expired: string;
    readonly wrongAzp: string;
    readonly malformed: string;
}> {
    // A structurally valid token whose signature does not verify: keep the header and payload, replace the
    // signature. Rotating one character would risk landing on the same byte.
    const [header, payload] = sampleJwt.split('.');
    const badSignature = `${header}.${payload}.aW52YWxpZC1zaWduYXR1cmU`;

    const { handle: wrongOriginHandle } = await leaseSession({
        slot: slotFor('k6', 'alfa'),
        publishableKey,
        origin: 'https://unauthorized.invalid',
        port,
    });
    const wrongAzp = (await remintFromSession(wrongOriginHandle)).token;

    return { badSignature, expired: sampleJwt, wrongAzp, malformed: 'not-a-jwt' };
}

const handlesPath = join(outDir, 'handles.json');
const handles = readHandles(handlesPath);
const { reuse, establish } = partitionHandles(
    handles,
    slots.map((slot) => slot.id),
);

console.log(
    `Leasing ${slots.length - 1} pool VU slots + the admin slot against ${origin} — ` +
        `${reuse.length} re-minting from a stored session, ${establish.length} signing in.`,
);

interface Member {
    readonly name: string;
    readonly email: string;
    readonly userId: string;
    readonly jwt: string;
    readonly sessionId: string;
    readonly devJwt: string;
}

const members: Member[] = [];

// ⛔ SEQUENTIAL, on purpose. `establishSession`'s pause after each create only spaces creates that are awaited one
// at a time (`establishSessionCallers.test.ts`). Re-mints are cheap, so the warm path is fast regardless.
for (const slot of slots) {
    // The roster lookup runs on the warm path too: it is what refuses a slot `poolAdmin` has un-marked since the
    // handle was stored, and it supplies the user id the pool files carry.
    const user = await resolvePoolUser(slot, port);
    const { jwt, handle } = await credentialFor(slot, handles[slot.id]);

    // Progress with a timestamp and no credential, so a failure names the identity it died on.
    console.log(`${new Date().toISOString()} ${slot.id}: ${handle === handles[slot.id] ? 're-minted' : 'signed in'}`);
    handles[slot.id] = handle;
    members.push({
        name: slot.id,
        email: slot.email,
        userId: user.id,
        jwt,
        sessionId: handle.sessionId,
        devJwt: handle.devJwt,
    });
}

const admin = members.find((member) => member.name === 'admin');
const pool = members.filter((member) => member.name !== 'admin');
const [sample] = pool;

if (!admin || !sample) {
    throw new Error('the pool produced no admin or no VU member');
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
        throw new Error(`admin token 403 — ${admin.email} carries no food:admin scope; run poolAdmin --apply.`);
    }

    await delay(1_500);
}

// ⛔ THE SERVICE SCENARIOS OPEN THEIR OWN POOL FILES, in two different shapes, at INIT. Without them
// food's `authFlood` and identity's `sessionHotPath`/`authRejection` never start — they die on a Go
// `stat` error naming a path. `k6TokenPoolShape.test.ts` derives the required keys from those scenarios' source.
const bearers = pool.map((member) => member.jwt);

writeFileSync(join(outDir, 'food-tokens.json'), `${JSON.stringify(buildFoodTokenPool(bearers), null, 4)}\n`);
writeFileSync(
    join(outDir, 'identity-tokens.json'),
    `${JSON.stringify(buildIdentityTokenPool(bearers, await mintRejections(sample.jwt)), null, 4)}\n`,
);
writeFileSync(join(outDir, 'pool.json'), `${JSON.stringify(pool, null, 4)}\n`);
writeFileSync(join(outDir, 'tokens.json'), `${JSON.stringify(bearers, null, 4)}\n`);
writeFileSync(join(outDir, 'admin.json'), `${JSON.stringify(admin, null, 4)}\n`);
writeFileSync(handlesPath, `${JSON.stringify(handles, null, 4)}\n`);
chmodSync(handlesPath, 0o600);

console.log(
    `Pool ready: ${pool.length} users, admin verified=${verified}. ` +
        `Wrote pool.json / tokens.json / admin.json to ${outDir}; handles.json (0600) saves the next run's sign-ins.`,
);
