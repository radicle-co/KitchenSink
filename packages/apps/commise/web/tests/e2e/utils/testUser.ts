import { createClerkClient } from '@clerk/backend';
import { decodeJwt } from '@clerk/backend/jwt';

// A fixed, reusable identity for sign-IN tests. The `+clerk_test` local-part marks it a Clerk test
// account (no real email is sent; it verifies with the fixed dev code), and the password clears
// Clerk's strength checks.
export const TEST_USER_EMAIL = 'commise-e2e-signin+clerk_test@example.com';
export const TEST_USER_PASSWORD = 'Commise-e2e-Test-9j2xQ!';

function client() {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required to provision e2e auth test users');
    }

    return createClerkClient({ secretKey });
}

/**
 * Idempotently ensure the sign-in test user exists with a known, verified email + password.
 *
 * @returns the Clerk user id — the caller ({@link globalSetup}) uses it to wait for the `external_id`
 *   backfill (see {@link waitForTestUserExternalId}) before any owner-gated spec runs.
 */
export async function ensureSignInTestUser(): Promise<string> {
    const clerk = client();
    const existing = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });
    const found = existing.data[0];

    if (found !== undefined) {
        return found.id;
    }

    // This Clerk instance requires first/last name + username on every user.
    const created = await clerk.users.createUser({
        emailAddress: [TEST_USER_EMAIL],
        password: TEST_USER_PASSWORD,
        firstName: 'Commise',
        lastName: 'Signin',
        username: 'commise_e2e_signin',
        skipPasswordChecks: true,
    });

    return created.id;
}

/**
 * Block until the Clerk user's `external_id` (the app-user ULID) has been backfilled by the async
 * `user.created` webhook (identity-webhooks → `clerk.users.updateUser({ externalId })`). Teardown deletes the
 * test user every run, so setup recreates a FRESH user and every run re-races this backfill; gating here makes
 * `external_id` a deterministic precondition, so every per-test token carries it (it is a USER property — once
 * set, all subsequently-minted tokens include it via the session-token customization).
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

/** A unique `+clerk_test` email for a one-off sign-up (so repeat runs never collide). */
export function uniqueSignUpEmail(): string {
    // Date.now() is fine here — this is Node test code, not the deterministic workflow sandbox.
    return `commise-e2e-signup-${Date.now()}+clerk_test@example.com`;
}

/**
 * Delete EVERY e2e test user from Clerk — the fixed sign-in fixture plus any sign-up users a crashed
 * test left behind. Deleting from Clerk is the only cleanup the e2e can do (the identity DB is
 * VPC-private), and it is sufficient: each delete fires the `user.deleted` webhook, which the sandbox
 * deletion-worker turns into a DB purge (account + profile removed, user row anonymized). Best-effort
 * — a cleanup failure must not fail an otherwise-green run.
 */
export async function deleteAllE2EUsers(): Promise<void> {
    const clerk = client();
    // `query` searches email / name / username, matching `commise-e2e-signin` and `commise-e2e-signup-*`.
    const { data } = await clerk.users.getUserList({ query: 'commise-e2e', limit: 100 });

    for (const user of data) {
        try {
            await clerk.users.deleteUser(user.id);
        } catch (err) {
            console.warn(`[e2e teardown] failed to delete Clerk user ${user.id}:`, err);
        }
    }
}
