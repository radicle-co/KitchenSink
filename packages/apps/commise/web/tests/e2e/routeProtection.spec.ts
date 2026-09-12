import { test, expect } from '@playwright/test';

import { route, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';
import {
    classifyNavigationTrace,
    trackMainFrameNavigations,
    waitForNavigationTraceToSettle,
} from './utils/navigationTrace';

// A signed-out user on a protected route is bounced to the app's OWN /sign-in (the custom <SignIn>
// page), not Clerk's hosted Account Portal — single-prefixed under the preview basePath, on the app
// origin. Runs in both shapes: the default preview run (PREVIEW_BASE_PATH=/pr-e2e) and the production
// run (E2E_BASE_PATH=''); in the prod shape hasDoublePrefix is inert (empty prefix), so the prod path
// is pinned by isRoute('/sign-in') + the app-origin check.
test.describe('route protection (signed out)', () => {
    for (const path of ['/profile', '/account', '/settings']) {
        test(`${path} redirects to the app /sign-in`, async ({ page }) => {
            await page.goto(route(path));

            await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);
            expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
            // The app's own sign-in, not Clerk's hosted Account Portal (accounts.dev).
            expect(page.url()).not.toContain('accounts.dev');
        });
    }

    test('home / SETTLES on the app /sign-in — it does not merely pass through it', async ({ page }) => {
        // ⚠️ This test used to assert `expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true)`
        // plus a retrying `toBeVisible` on the email field. On 2026-08-07 production bounced forever between
        // /en and /en/sign-in?redirect_url=%2Fen and BOTH assertions still passed: `expect.poll` resolves on
        // the first favourable sample, which an infinite loop supplies every other hop, and the loop really
        // does render the sign-in form on each visit. So the arrival is now asserted as a SETTLED state —
        // navigation must stop, no pathname may be visited three times, and the total must stay inside a
        // budget. See tests/e2e/utils/navigationTrace.ts.
        const trace = trackMainFrameNavigations(page);

        await page.goto(route('/'));

        // Owner decision 2026-07-28: the front door is the sign-in form itself — there is no branded
        // welcome/landing interstitial in front of it any more. So the root now agrees with the deep protected
        // routes asserted above: signed out ⇒ /sign-in, single-prefixed, on the app's own origin.
        // The sign-in form itself is rendered — not merely the URL. The email field is the landmark that
        // proves Clerk's <SignIn> mounted rather than 404'd.
        await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 20_000 });

        const urls = await waitForNavigationTraceToSettle(trace);
        const verdict = classifyNavigationTrace({
            urls,
            expectedFinalPathname: route('/sign-in'),
            maxNavigations: 8,
        });

        expect(verdict.findings.join('\n')).toBe('');
        expect(isRoute(pathnameOf(page), '/sign-in')).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
        expect(page.url()).not.toContain('accounts.dev');
    });

    test('the sign-in and sign-up pages are reachable without auth', async ({ page }) => {
        await page.goto(route('/sign-in'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);

        await page.goto(route('/sign-up'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up')).toBe(true);
    });

    test('sign-up is reachable FROM the sign-in form (the entry the welcome hero used to provide)', async ({
        page,
    }) => {
        // Deleting the welcome hero removed the app's "Get started" CTA, so registration now depends entirely
        // on the sign-up link Clerk renders because the sign-in page passes it a `signUpUrl`. That link is the
        // only remaining path to sign-up for a new visitor on web — assert it, don't assume it.
        await page.goto(route('/'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);

        await page.getByRole('link', { name: /sign up/i }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up'), { timeout: 20_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });
});
