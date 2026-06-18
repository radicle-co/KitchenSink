import { createClerkClient } from '@clerk/backend';

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

/** Idempotently ensure the sign-in test user exists with a known, verified email + password. */
export async function ensureSignInTestUser(): Promise<void> {
    const clerk = client();
    const existing = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });

    if (existing.totalCount > 0) {
        return;
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
