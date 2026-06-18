import { test, expect } from '@playwright/test';

import { route, isRoute, pathnameOf } from './utils/base-path';

// A signed-out user must never reach protected content — Clerk bounces them to an auth surface.
// NOTE: today that surface is Clerk's HOSTED Account Portal (accounts.dev), not the app's own
// /sign-in — clerkMiddleware has no signInUrl configured, unlike the home page which bounces to the
// app /sign-in. This suite asserts the SECURITY property (no protected content for the signed-out);
// the app-vs-portal destination is tracked as a separate follow-up.
test.describe('route protection (signed out)', () => {
    for (const path of ['/profile', '/account', '/settings']) {
        test(`${path} blocks unauthenticated access`, async ({ page }) => {
            await page.goto(route(path));

            // Redirected to a Clerk auth surface, never rendering the protected page itself.
            await expect(page).toHaveURL(/sign-in|sign-up/);
            await expect(page.getByRole('heading', { name: /^(Profile|Account|Settings)$/ })).toHaveCount(0);
        });
    }

    test('home / redirects unauthenticated users to the app sign-in', async ({ page }) => {
        await page.goto(route('/'));

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);
    });

    test('the sign-in and sign-up pages are reachable without auth', async ({ page }) => {
        await page.goto(route('/sign-in'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);

        await page.goto(route('/sign-up'));
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up')).toBe(true);
    });
});
