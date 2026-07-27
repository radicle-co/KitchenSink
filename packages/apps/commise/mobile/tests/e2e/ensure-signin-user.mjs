/**
 * Idempotently provision the Clerk sign-in test user for the Maestro mobile E2E job.
 *
 * IDENTITY CONTRACT with the web Playwright suite (read before changing either side).
 * The two suites share ONE Clerk instance (sandbox dev) and deliberately own DIFFERENT users:
 *
 *   - WEB (`packages/apps/commise/web/tests/e2e/utils/runFixtureIdentity.ts`) derives a PER-RUN identity
 *     (`commise-e2e-signin-<runKey>+clerk_test@example.com`) because concurrent CI runs used to delete
 *     each other's shared fixture. Its teardown now deletes only its own run key's users, plus run-scoped
 *     leftovers older than 12h.
 *   - MOBILE (this script) owns the FIXED, long-lived `commise-e2e-signin+clerk_test@example.com`. It
 *     cannot be per-run: `.maestro/auth/signin-home.yaml` types the address into the app as LITERAL text,
 *     so nothing on-device can derive it. (Making mobile per-run too means parametrizing that flow with
 *     `-e E2E_SIGNIN_EMAIL=…` from run-maestro-flows.sh — a separate change.)
 *
 * The web rules CANNOT match this address: every run-scoped shape carries a `-` separator after
 * `signin`/`signup`, this one does not — asserted by `runFixtureIdentity.test.ts`
 * ("NEVER matches the fixed Maestro fixture"). So no web run, and no age-based sweep, can delete the
 * user a live Maestro run is signing in as. That is what makes the fixed identity safe here.
 *
 * Credentials MUST mirror `.maestro/auth/signin-home.yaml` and the web `TEST_USER_PASSWORD`
 * (cross-platform parity). `+clerk_test` marks a Clerk test account: no real email is sent and it verifies
 * with the fixed dev code 424242 (the value the sign-in flow types).
 *
 * Usage: `CLERK_SECRET_KEY=sk_... node packages/apps/commise/mobile/tests/e2e/ensure-signin-user.mjs`
 */
import { createClerkClient } from '@clerk/backend';

/** Keep in lockstep with `MAESTRO_SHARED_FIXTURE_EMAIL` in the web suite's runFixtureIdentity.ts. */
const TEST_USER_EMAIL = 'commise-e2e-signin+clerk_test@example.com';
const TEST_USER_PASSWORD = 'Commise-e2e-Test-9j2xQ!';
const TEST_USER_USERNAME = 'commise_e2e_signin';

const secretKey = process.env['CLERK_SECRET_KEY'];

if (!secretKey) {
    console.error('ensure-signin-user: CLERK_SECRET_KEY is required.');
    process.exit(1);
}

const clerk = createClerkClient({ secretKey });

const existing = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });

if (existing.totalCount > 0) {
    console.log('ensure-signin-user: test user already exists.');
    process.exit(0);
}

try {
    // This Clerk instance requires first/last name + username on every user.
    await clerk.users.createUser({
        emailAddress: [TEST_USER_EMAIL],
        password: TEST_USER_PASSWORD,
        firstName: 'Commise',
        lastName: 'Signin',
        username: TEST_USER_USERNAME,
        skipPasswordChecks: true,
    });

    console.log('ensure-signin-user: created the test user.');
} catch (err) {
    // Two concurrent Maestro jobs can both see "absent" and then race the create; the loser gets a
    // 422 on the unique email/username. The post-condition ("the user exists") still holds, so verify it
    // and succeed rather than failing a whole emulator run on a benign race.
    const raced = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });

    if (raced.totalCount > 0) {
        console.log('ensure-signin-user: lost a create race; the test user exists.');
        process.exit(0);
    }

    console.error('ensure-signin-user: failed to create the test user:', err);
    process.exit(1);
}
