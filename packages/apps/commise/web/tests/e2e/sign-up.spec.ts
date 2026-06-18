import { test, expect } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isHome, hasDoublePrefix, pathnameOf } from './utils/base-path';
import { signInWithTicket } from './utils/auth';
import { TEST_USER_PASSWORD, uniqueSignUpEmail, deleteUsersByEmail } from './utils/test-user';

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
            await page.getByRole('button', { name: /continue|sign up/i }).click();

            // Email verification — Clerk test emails (`+clerk_test`) accept the fixed code 424242.
            // The OTP auto-submits on the 6th digit, so wait for Clerk's async "prepare" (send) call to
            // settle first — otherwise the attempt races ahead of it ("need to send a verification
            // code before attempting to verify").
            await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible({ timeout: 15_000 });
            await page.waitForLoadState('networkidle');
            await page.getByRole('textbox', { name: /verification code/i }).fill('424242');

            await expect.poll(() => isHome(pathnameOf(page)), { timeout: 20_000 }).toBe(true);
            expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
            await expect(page.getByRole('heading', { name: /welcome to commise/i })).toBeVisible();
        } finally {
            await deleteUsersByEmail(email);
        }
    });
});
