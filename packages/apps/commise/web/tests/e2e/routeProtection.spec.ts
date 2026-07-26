import { test, expect } from '@playwright/test';

import { route, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';

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

    test('home / redirects unauthenticated users to the branded welcome entry', async ({ page }) => {
        await page.goto(route('/'));

        // U8: the front-door landing is the branded welcome hero (which then leads into sign-in/sign-up),
        // not the bare sign-in form. Deep protected routes still bounce to /sign-in (asserted above).
        await expect.poll(() => isRoute(pathnameOf(page), '/welcome')).toBe(true);
    });

    test('the sign-in and sign-up pages are reachable without auth', async ({ page }) => {
        await page.goto(route('/sign-in'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);

        await page.goto(route('/sign-up'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up')).toBe(true);
    });
});
