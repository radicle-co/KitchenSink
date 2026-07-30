import { test, expect } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isHome, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { submitClerkEmailCode } from './utils/clerkEmailCode';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './utils/testUser';

test.describe('sign-in flow', () => {
    test('signing in through the form lands on the home page (single basePath prefix)', async ({ page }) => {
        // Long by nature, and it does NOT fit the 30s default: this test alone budgets 15s waiting for the
        // "check your email" step, then polls up to 30s for the post-verification redirect — a poll whose
        // window equals the whole test's budget can never complete, so the test always dies first. It only
        // passed locally because the earlier steps are fast enough here to leave room; on a CI runner they
        // are not, and it failed all three attempts. `test.slow()` triples the budget to 90s, the same
        // treatment `signOut.spec.ts` gives its Clerk-driven flow.
        test.slow();

        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        // getByRole('textbox', …) avoids the "Show password" button that getByLabel(/password/i) catches.
        await page.getByRole('textbox', { name: /email/i }).fill(TEST_USER_EMAIL);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER_PASSWORD);

        // This instance verifies a new device with an email code — `+clerk_test` accepts 424242. Clerk SENDS
        // that code with an async `prepare_*` POST against the sign-in attempt, and submitting the digits
        // before it resolves lands on "You need to send a verification code before attempting to verify."
        // `submitClerkEmailCode` owns that barrier, its recovery, and the explicit submit that removes the
        // dependency on Clerk's OTP auto-submit — shared with signUp.spec.ts, which hits the same race on
        // its own `sign_ups` prepare call.
        await submitClerkEmailCode(page, {
            attempt: 'sign_ins',
            triggerSend: () => page.getByRole('button', { name: 'Continue' }).click(),
            expectStep: () =>
                expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15_000 }),
        });

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
