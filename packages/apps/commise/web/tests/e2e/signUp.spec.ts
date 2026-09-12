import { test, expect } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isHome, hasDoublePrefix, pathnameOf } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { clerkPrimarySubmit } from './utils/clerkForm';
import { submitClerkEmailCode } from './utils/clerkEmailCode';
import { TEST_USER_PASSWORD, uniqueSignUpEmail, deleteUsersByEmail } from './utils/testUser';

test.describe('sign-up flow', () => {
    // The reported regression: after signup the user is signed in but still on /sign-up; <SignUp>
    // can't render for a signed-in user and redirects to forceRedirectUrl. With a double-prefixed
    // basePath that looped to /pr-{N}/pr-{N}/ and left a blank /sign-up. This is the cheap, robust
    // reproduction (no email-verification UI needed): be signed in, then hit /sign-up.
    test('a signed-in user visiting /sign-up is redirected to home, not stranded or double-prefixed', async ({
        page,
    }) => {
        await signInWithTicket(page);

        await page.goto(route('/sign-up'));

        await expect.poll(() => isHome(pathnameOf(page)), { timeout: 15_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
        await expect(page.getByRole('heading', { name: /welcome to commise/i })).toBeVisible();
    });

    test('completing the sign-up form creates a user and lands on home', async ({ page }) => {
        // Does NOT fit the 30s default, for the same reason signIn.spec.ts does not: this test budgets 15s
        // for the verification step, up to 30s for Clerk's send, and — on the recovery path — up to 60s
        // waiting out Clerk's Resend cooldown, before a 20s redirect poll. Under the default budget the
        // recovery could never complete, so the test would die before the safety net it carries could run.
        test.slow();

        const email = uniqueSignUpEmail();

        try {
            await setupClerkTestingToken({ page });
            await page.goto(route('/sign-up'));

            // This instance collects first/last name + username alongside email + password.
            // getByRole('textbox', …) avoids the "Show password" button getByLabel(/password/i) catches.
            await page.getByRole('textbox', { name: /first name/i }).fill('E2E');
            await page.getByRole('textbox', { name: /last name/i }).fill('Signup');
            await page.getByRole('textbox', { name: /username/i }).fill(`e2e_${Date.now()}`);
            await page.getByRole('textbox', { name: /email/i }).fill(email);
            await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER_PASSWORD);

            // Email verification — Clerk test emails (`+clerk_test`) accept the fixed code 424242. The
            // send is an async `prepare_verification` POST and entering the digits before it resolves
            // breaks the flow; `submitClerkEmailCode` owns that barrier (and its recovery) for both auth
            // flows, so this spec and signIn.spec.ts cannot drift apart on it.
            await submitClerkEmailCode(page, {
                attempt: 'sign_ups',
                // Was `/continue|sign up/i`, which ALSO matched Clerk's "Sign in with Google Continue"
                // button (strict mode violation, 2 elements). A regex cannot be made exact, so the fix is
                // the shared exact-match locator — see `clerkForm.ts`.
                triggerSend: () => clerkPrimarySubmit(page).click(),
                expectStep: () =>
                    expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible({
                        timeout: 15_000,
                    }),
            });

            await expect.poll(() => isHome(pathnameOf(page)), { timeout: 20_000 }).toBe(true);
            expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
            await expect(page.getByRole('heading', { name: /welcome to commise/i })).toBeVisible();
        } finally {
            await deleteUsersByEmail(email);
        }
    });
});
