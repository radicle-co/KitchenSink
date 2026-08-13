import { createClerkClient } from '@clerk/backend';
import { decodeJwt } from '@clerk/backend/jwt';

import {
    E2E_USER_QUERY,
    LEAKED_FIXTURE_MAX_AGE_MS,
    planE2EUserCleanup,
    resolveRunKey,
    signInFixtureEmail,
    signInFixtureUsername,
    signUpEmail,
} from './runFixtureIdentity';

/**
 * This run's identity, derived once per process and pinned into the environment so `globalSetup`, every
 * Playwright worker, and `globalTeardown` agree. See `runFixtureIdentity.ts` for WHY it is per-run: a
 * fixed, shared fixture on the shared sandbox Clerk instance let two concurrent CI runs delete each
 * other's sign-in user.
 */
export const RUN_KEY = resolveRunKey();

/**
 * The sign-IN identity for THIS run. `+clerk_test` marks it a Clerk test account (no real email is sent;
 * it verifies with the fixed dev code 424242), and the password clears Clerk's strength checks.
 */
export const TEST_USER_EMAIL = signInFixtureEmail(RUN_KEY);
export const TEST_USER_USERNAME = signInFixtureUsername(RUN_KEY);
export const TEST_USER_PASSWORD = 'Commise-e2e-Test-9j2xQ!';

function client() {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required to provision e2e auth test users');
    }

    return createClerkClient({ secretKey });
}

/**
 * Idempotently ensure THIS RUN's sign-in test user exists with a known, verified email + password.
 *
 * @returns the Clerk user id — the caller (`globalSetup`) uses it to wait for the `external_id`
 *   backfill (see {@link waitForTestUserExternalId}) before any owner-gated spec runs.
 * @sideEffect Reads and writes Clerk users via the Backend API.
 */
export async function ensureSignInTestUser(): Promise<string> {
    const clerk = client();
    const existing = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });
    const found = existing.data[0];

    if (found !== undefined) {
        return found.id;
    }

    try {
        // This Clerk instance requires first/last name + username on every user; the username is unique
        // per instance, so it is run-scoped too (a shared literal made concurrent runs race on it).
        const created = await clerk.users.createUser({
            emailAddress: [TEST_USER_EMAIL],
            password: TEST_USER_PASSWORD,
            firstName: 'Commise',
            lastName: 'Signin',
            username: TEST_USER_USERNAME,
            skipPasswordChecks: true,
        });

        return created.id;
    } catch (err) {
        // Lost a create race (two processes of the same run): the user now exists, so adopt it rather
        // than failing the whole suite on an identifier-exists 422. Anything else is a real failure.
        const raced = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });
        const adopted = raced.data[0];

        if (adopted !== undefined) {
            return adopted.id;
        }

        throw err;
    }
}

/**
 * Block until the Clerk user's `external_id` (the app-user ULID) has been backfilled by the async
 * `user.created` webhook (identity-webhooks → `clerk.users.updateUser({ externalId })`). Every run
 * provisions a FRESH user (its identity is run-scoped) and so re-races this backfill; gating here makes
 * `external_id` a deterministic precondition, so every per-test token carries it (it is a USER property —
 * once set, all subsequently-minted tokens include it via the session-token customization).
 *
 * On timeout this throws LOUD, naming the webhook prerequisite — so a genuine sandbox webhook outage surfaces
 * as a clear setup failure rather than a mystery flake, and is never masked.
 *
 * @sideEffect Polls the Clerk Backend API (`users.getUser`) and sleeps between attempts.
 */
export async function waitForTestUserExternalId(
    userId: string,
    { timeoutMs = 30_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
    const clerk = client();
    // Date.now()/setTimeout are fine here — Node test setup, not the deterministic workflow sandbox.
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        const user = await clerk.users.getUser(userId);

        if (typeof user.externalId === 'string' && user.externalId.length > 0) {
            return;
        }

        if (Date.now() >= deadline) {
            throw new Error(
                `waitForTestUserExternalId: Clerk user ${userId} still has no externalId after ${timeoutMs}ms. ` +
                    'The user.created webhook (identity-webhooks → clerk.users.updateUser) must backfill it; a ' +
                    'persistent failure here is a sandbox webhook outage, not a test bug.',
            );
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
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
 * earlier spec (the suite runs serially against one fixture user and specs do not sign out).
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
 * Teardown cleanup, SCOPED so it can never touch a concurrent run.
 *
 * Two passes over ONE list call (`query: 'commise-e2e'`, the shared prefix of every e2e user):
 *   1. This run's own users — the sign-in fixture plus any sign-up user a crashed spec left behind.
 *   2. An AGE-GATED sweep of run-scoped users from OTHER runs, older than {@link LEAKED_FIXTURE_MAX_AGE_MS}
 *      (12h > the 6h GitHub job cap), i.e. provably not owned by anything still running. This is the
 *      safety net for crashed runs that never reached their own teardown.
 * The fixed Maestro fixture (`commise-e2e-signin+clerk_test@example.com`) matches NEITHER rule by
 * construction — it has no run-key segment — so the mobile job's long-lived user survives.
 *
 * Deleting from Clerk is the only cleanup the e2e can do (the identity DB is VPC-private), and it is
 * sufficient: each delete fires the `user.deleted` webhook, which the sandbox deletion-worker turns into a
 * DB purge (account + profile removed, user row anonymized). Best-effort per user — one failed delete must
 * not fail an otherwise-green run.
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
