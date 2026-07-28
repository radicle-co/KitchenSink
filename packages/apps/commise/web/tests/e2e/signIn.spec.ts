import { test, expect } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isHome, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
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
        await page.getByRole('button', { name: 'Continue' }).click();
        // This instance verifies a new device with an email code — `+clerk_test` accepts 424242. The
        // OTP auto-submits on the 6th digit, so wait for the async "prepare" (send) to settle first.
        await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15_000 });
        await page.waitForLoadState('networkidle');
        await page.getByRole('textbox', { name: /verification code/i }).fill('424242');

        // Do NOT rely on the auto-submit alone. It fires from a change handler on the 6th digit, and when it
        // does not fire the test just sat here until the poll expired — the failure mode seen intermittently
        // in CI (passing on one commit, failing all three attempts on the next, with no related change).
        // Clerk still renders a Continue button on this step, so submit explicitly IF the step is still up.
        // Guarded rather than unconditional: on the common path the auto-submit has already navigated, and
        // clicking a detached button would fail. This makes the outcome independent of that race.
        const verifyContinue = page.getByRole('button', { name: 'Continue' });

        if (await verifyContinue.isVisible().catch(() => false)) {
            await verifyContinue.click().catch(() => undefined);
        }

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
