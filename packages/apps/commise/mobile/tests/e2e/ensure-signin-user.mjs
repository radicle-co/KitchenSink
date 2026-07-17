/**
 * Idempotently provision the shared Clerk sign-in test user for the Maestro mobile E2E job — the native
 * counterpart of the web suite's `ensureSignInTestUser` (packages/apps/commise/web/tests/e2e/utils/testUser.ts).
 * Credentials MUST mirror the `.maestro/auth/signin-home.yaml` flow and the web `TEST_USER_*` (cross-platform
 * parity). `+clerk_test` marks a Clerk test account: no real email is sent and it verifies with the fixed dev
 * code 424242 (the value the sign-in flow types).
 *
 * Usage: `CLERK_SECRET_KEY=sk_... node packages/apps/commise/mobile/tests/e2e/ensure-signin-user.mjs`
 */
import { createClerkClient } from '@clerk/backend';

const TEST_USER_EMAIL = 'commise-e2e-signin+clerk_test@example.com';
const TEST_USER_PASSWORD = 'Commise-e2e-Test-9j2xQ!';

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

// This Clerk instance requires first/last name + username on every user.
await clerk.users.createUser({
    emailAddress: [TEST_USER_EMAIL],
    password: TEST_USER_PASSWORD,
    firstName: 'Commise',
    lastName: 'Signin',
    username: 'commise_e2e_signin',
    skipPasswordChecks: true,
});

console.log('ensure-signin-user: created the test user.');
