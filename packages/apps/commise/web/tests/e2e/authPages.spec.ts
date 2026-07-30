import { test, expect } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';

// The auth pages must actually MOUNT the Clerk widget under a preview basePath (a bare shell with only
// the <title> is the classic "Clerk derives its path from the basePath-stripped pathname" failure),
// and cross-links between them must resolve with the basePath applied EXACTLY ONCE.
test.describe('auth pages render and cross-link under the preview basePath', () => {
    test('sign-in page mounts the Clerk widget, not a blank shell', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        await expect(page).toHaveTitle(/Commise/);
        await expect(page.getByRole('heading', { name: 'Sign in to Commise' })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
    });

    test('sign-up page mounts the Clerk widget, not a blank shell', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-up'));

        await expect(page).toHaveTitle(/Commise/);
        await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
    });

    test('sign-in → "Sign up" link lands on /sign-up with a single basePath prefix', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        await page.getByRole('link', { name: /sign up/i }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up')).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    test('sign-up → "Sign in" link lands on /sign-in with a single basePath prefix', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-up'));

        await page.getByRole('link', { name: /sign in/i }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });
});
