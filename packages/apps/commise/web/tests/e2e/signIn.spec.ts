import { test, expect } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isHome, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './utils/testUser';

test.describe('sign-in flow', () => {
    test('signing in through the form lands on the home page (single basePath prefix)', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        // getByRole('textbox', …) avoids the "Show password" button that getByLabel(/password/i) catches.
        await page.getByRole('textbox', { name: /email/i }).fill(TEST_USER_EMAIL);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER_PASSWORD);
        await page.getByRole('button', { name: 'Continue' }).click();
        // This instance verifies a new device with an email code — `+clerk_test` accepts 424242. The
        // OTP auto-submits on the 6th digit, so wait for the async "prepare" (send) to settle first.
        await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15_000 });
        await page.waitForLoadState('networkidle');
        await page.getByRole('textbox', { name: /verification code/i }).fill('424242');

        await expect.poll(() => isHome(pathnameOf(page)), { timeout: 30_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
        await expect(page.getByRole('heading', { name: /welcome to commise/i })).toBeVisible();
    });

    test('a signed-in user visiting /sign-in is redirected to home', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/sign-in'));

        await expect.poll(() => isHome(pathnameOf(page)), { timeout: 15_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    test('an authenticated user is allowed through to a protected route', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/profile'));

        // The middleware lets the authenticated user through — not bounced back to an auth surface.
        await expect.poll(() => isRoute(pathnameOf(page), '/profile'), { timeout: 15_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    test('signing out drops the session (a protected route bounces again)', async ({ page }) => {
        await signInWithTicket(page);

        await clerk.signOut({ page });

        await page.goto(route('/profile'));
        await expect(page).toHaveURL(/sign-in|sign-up/);
    });
});
