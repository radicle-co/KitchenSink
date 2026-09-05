/**
 * Provision (or reuse) THIS RUN's Clerk sign-in fixture, and print its identity for a shell to consume.
 *
 * ## Why this exists in the shared package rather than beside the mobile suite
 *
 * The mobile suite provisioned a FIXED user — `commise-e2e-signin+clerk_test@example.com` — long after the
 * web suite had been given run-scoped ones. That is not a cosmetic difference: the sandbox Clerk instance
 * is SHARED, so a fixed address means two concurrent runs address the SAME user, and whichever tears down
 * first deletes the other's live fixture. `runFixtureIdentity.ts` records the web incident that proved it
 * (commit `bbf7ea7c`, one job passing while its identical twin failed). Mobile had the same exposure and
 * had simply not hit it yet, because the tier had never run.
 *
 * ⛔ So the derivation is imported, never re-implemented. A second copy of "which user is this run's" is
 * the same bug one file over.
 *
 * ## Contract with the caller
 *
 * Prints two `KEY=VALUE` lines on stdout — `SIGNIN_EMAIL` and `SIGNIN_PASSWORD` — and nothing else, so a
 * shell can `eval` or read them without parsing prose. Diagnostics go to stderr. Idempotent: a rerun of the
 * same run key (a re-attempt keeps `GITHUB_RUN_ID` and changes `GITHUB_RUN_ATTEMPT`, so it derives a NEW
 * key) reuses an existing user rather than failing on Clerk's per-instance uniqueness.
 *
 * @sideEffect Creates a Clerk user, or reuses one; writes to stdout and stderr.
 */
import { createClerkClient } from '@clerk/backend';

import { resolveRunKey, signInFixtureEmail, signInFixtureUsername } from './runFixtureIdentity.js';

/**
 * The fixture password. Shared across platforms deliberately — it is not a secret (the account exists only
 * on a development Clerk instance, verifies with the fixed dev code, and owns nothing), and the flows type
 * it literally, so a per-run value would buy nothing and cost a second thing to thread through.
 */
export const SIGN_IN_FIXTURE_PASSWORD = 'Commise-e2e-Test-9j2xQ!';

const secretKey = process.env['CLERK_SECRET_KEY'];

if (secretKey === undefined || secretKey.trim() === '') {
    console.error('provision-signin-fixture: CLERK_SECRET_KEY is required.');
    process.exit(1);
}

const runKey = resolveRunKey();
const email = signInFixtureEmail(runKey);
const username = signInFixtureUsername(runKey);
const clerk = createClerkClient({ secretKey });

const existing = await clerk.users.getUserList({ emailAddress: [email] });

if (existing.totalCount === 0) {
    // The Clerk instance requires first/last name AND a username on every user, and enforces the username
    // unique per instance — which is why it is run-scoped too, not just the address.
    await clerk.users.createUser({
        emailAddress: [email],
        password: SIGN_IN_FIXTURE_PASSWORD,
        firstName: 'Commise',
        lastName: 'Signin',
        username,
        skipPasswordChecks: true,
    });
    console.error(`provision-signin-fixture: created ${email} (run key ${runKey}).`);
} else {
    console.error(`provision-signin-fixture: reusing ${email} (run key ${runKey}).`);
}

// stdout is the CONTRACT — two lines, nothing else.
console.log(`SIGNIN_EMAIL=${email}`);
console.log(`SIGNIN_PASSWORD=${SIGN_IN_FIXTURE_PASSWORD}`);
