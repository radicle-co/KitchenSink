import { createClerkClient } from '@clerk/backend';
import { decodeJwt } from '@clerk/backend/jwt';

import {
    E2E_USER_QUERY,
    LEAKED_FIXTURE_MAX_AGE_MS,
    planE2EUserCleanup,
    resolveRunKey,
    signUpEmail,
} from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, resolvePoolUser } from '@kitchensink/e2e-fixtures/lease';
import { POOL_PASSWORD } from '@kitchensink/e2e-fixtures/testPool';

import { webPoolSlot } from './poolSlot';

/**
 * This run's key, derived once per process and pinned into the environment so `globalSetup`, every Playwright
 * worker, and `globalTeardown` agree. It scopes the ONE user this suite still creates — `signUp.spec.ts`'s, whose
 * subject is registration itself — and this process's auth-state file.
 */
export const RUN_KEY = resolveRunKey();

/**
 * The fixed test-pool slot this process signs in as — see `poolSlot.ts`. `+clerk_test` marks it a Clerk test
 * account (no real email is sent; it verifies with the fixed dev code 424242).
 */
export const TEST_SLOT = webPoolSlot({
    COMMISE_E2E_SHARD: process.env['COMMISE_E2E_SHARD'],
    PLAYWRIGHT_MOCKED_ONLY: process.env['PLAYWRIGHT_MOCKED_ONLY'],
});

/** The sign-IN identity: the slot's address. */
export const TEST_USER_EMAIL = TEST_SLOT.email;

/** The password `poolAdmin` creates a web slot with, which `signIn.spec.ts` types. */
export const TEST_USER_PASSWORD = POOL_PASSWORD;

function client() {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required to provision e2e auth test users');
    }

    return createClerkClient({ secretKey });
}

/**
 * Resolve this process's pool slot to its Clerk user, refusing a slot `poolAdmin` has not provisioned.
 *
 * ⛔ IT CREATES NOTHING. This used to find-or-create a run-scoped user and then block on the `user.created` webhook
 * backfilling its `external_id`. A pool slot is created once by `poolAdmin`, which waits for that backfill itself,
 * so `resolvePoolUser` simply refuses a slot that is absent, unmarked, or still missing its `external_id` — and
 * the fix it names is `poolAdmin --apply`, never a user minted by a test run.
 *
 * ⚠️ The local `E2E_LOCAL_IDENTITY` path that WROTE a made-up `external_id` onto the user is gone with it: on a
 * shared pool user that write would re-point a real slot at an app user that does not exist, for every run after.
 *
 * @returns the Clerk user id.
 * @sideEffect Reads Clerk users via the Backend API.
 */
export async function resolveSignInTestUser(): Promise<string> {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required to resolve the e2e test-pool slot');
    }

    return (await resolvePoolUser(TEST_SLOT, clerkLeasePort(secretKey))).id;
}

/**
 * Read the status Clerk itself holds for a session, straight from the Backend API.
 *
 * This is the ONLY way a test can assert that a sign-out actually ENDED the session rather than merely
 * navigated somewhere plausible. `useClerk().signOut` resolves without revoking anything when clerk-js has
 * not loaded (B23 — `IsomorphicClerk` queues the call in `premountMethodCalls`), so an assertion on the
 * landing URL alone can go green while the session stays live and keeps minting fresh JWTs.
 *
 * @param sessionId - the Clerk session id, e.g. from {@link sessionIdFromCookies}.
 * @returns Clerk's own session status — `'removed'` (or `'ended'`/`'revoked'`) once a sign-out really landed.
 * @sideEffect Calls the Clerk Backend API.
 */
export async function clerkSessionStatus(sessionId: string): Promise<string> {
    const session = await client().sessions.getSession(sessionId);

    return session.status;
}

/**
 * The session id (`sid`) carried by the browser's `__session` cookie — i.e. the session THIS browser context
 * is actually authenticated with, as opposed to any other session the shared test user may still hold from an
 * earlier spec (the suite runs serially against one pool user and specs do not sign out).
 *
 * @param cookies - `page.context().cookies()` output.
 * @returns the `sid` claim, or `null` when no `__session` cookie is present (i.e. already signed out).
 */
export function sessionIdFromCookies(cookies: readonly { name: string; value: string }[]): string | null {
    const session = cookies.find((cookie) => cookie.name === '__session');

    if (session === undefined) {
        return null;
    }

    return decodeJwt(session.value).payload.sid;
}

/** Delete every Clerk user with this primary email — cleans up accounts a sign-up test created. */
export async function deleteUsersByEmail(email: string): Promise<void> {
    const clerk = client();
    const { data } = await clerk.users.getUserList({ emailAddress: [email] });

    for (const user of data) {
        await clerk.users.deleteUser(user.id);
    }
}

/** Monotonic within a process, so two sign-up emails minted in the same millisecond still differ. */
let signUpCounter = 0;

/** A unique, RUN-SCOPED `+clerk_test` email for a one-off sign-up (so repeat/parallel runs never collide). */
export function uniqueSignUpEmail(): string {
    // Date.now() is fine here — this is Node test code, not the deterministic workflow sandbox.
    signUpCounter += 1;

    return signUpEmail(RUN_KEY, `${Date.now().toString(36)}${signUpCounter}`);
}

/**
 * Teardown cleanup of the SIGN-UP carve-out, SCOPED so it can never touch a concurrent run or the test pool.
 *
 * Two passes over ONE list call (`query: 'commise-e2e'`, the shared prefix of every run-minted e2e user):
 *   1. This run's own sign-up users — any a crashed `signUp.spec.ts` left behind.
 *   2. An AGE-GATED sweep of run-scoped users from OTHER runs, older than {@link LEAKED_FIXTURE_MAX_AGE_MS}
 *      (12h > the 6h GitHub job cap), i.e. provably not owned by anything still running — including the
 *      pre-cutover run-minted sign-in fixtures still on the shared instance.
 * No test-pool slot matches either rule (`runFixtureIdentity.test.ts` asserts it over the whole roster), so the
 * pool survives every sweep.
 *
 * ⚠️ A Clerk delete is NOT data cleanup — a deleted user's public content survives, pseudonymised — which is
 * exactly why sign-in identities are a fixed pool whose DATA `resetPool` empties instead. A sign-up user authors
 * nothing, so for this carve-out the delete is enough. Best-effort per user — one failed delete must not fail an
 * otherwise-green run.
 *
 * @returns the ids actually deleted, split by rule (own vs leaked), for the teardown log.
 * @sideEffect Lists and deletes Clerk users.
 */
export async function deleteRunScopedE2EUsers({
    maxAgeMs = LEAKED_FIXTURE_MAX_AGE_MS,
}: { maxAgeMs?: number } = {}): Promise<{ own: string[]; leaked: string[] }> {
    const clerk = client();
    const { data } = await clerk.users.getUserList({ query: E2E_USER_QUERY, limit: 100 });

    const plan = planE2EUserCleanup(
        data.map((user) => ({
            id: user.id,
            emails: user.emailAddresses.map((address) => address.emailAddress),
            createdAtMs: user.createdAt,
        })),
        { runKey: RUN_KEY, nowMs: Date.now(), maxAgeMs },
    );

    const deleted = { own: [] as string[], leaked: [] as string[] };

    for (const [rule, ids] of [
        ['own', plan.ownFixtureIds],
        ['leaked', plan.leakedIds],
    ] as const) {
        for (const id of ids) {
            try {
                await clerk.users.deleteUser(id);
                deleted[rule].push(id);
            } catch (err) {
                console.warn(`[e2e teardown] failed to delete Clerk user ${id} (${rule}):`, err);
            }
        }
    }

    return deleted;
}
