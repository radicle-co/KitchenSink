import { test, expect } from '@playwright/test';

import { route, isRoute, pathnameOf } from './utils/basePath';

// U8: the branded welcome / auth-entry hero is the signed-out front door. It is public (only signed-IN
// users are bounced off it to Home), so a signed-out context renders it directly. These assertions use
// role/label selectors only (repo Playwright rule — no data-testid / waitForTimeout).
test.describe('welcome / auth-entry hero (signed out)', () => {
    test('renders the branded hero — wordmark, tagline, and the gradient "Get started" CTA', async ({ page }) => {
        await page.goto(route('/welcome'));

        await expect(page.getByRole('heading', { name: 'Commise' })).toBeVisible();
        await expect(page.getByText('Cook with confidence. Plan with ease.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
        await expect(page.getByText('Save recipes')).toBeVisible();
    });

    test('"Get started" leads into sign-up', async ({ page }) => {
        await page.goto(route('/welcome'));

        await page.getByRole('link', { name: 'Get started' }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up')).toBe(true);
    });

    test('"Sign in" leads into sign-in for returning users', async ({ page }) => {
        await page.goto(route('/welcome'));

        await page.getByRole('link', { name: /already have an account\? sign in/i }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);
    });
});
