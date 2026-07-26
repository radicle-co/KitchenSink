import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * U3 — the identity/auth surface (`/account`, `/profile`, `/settings`) now renders inside the shared app
 * navigation shell (`AppShell` → `HomeChrome`), fixing the previously bare, nav-less routes. This spec
 * exercises that deliberate, approved DESKTOP change: at a 1280px desktop viewport each route mounts the
 * desktop sidebar (its "Collapse navigation" control is sidebar-only, `lg:flex`) AND the sticky top bar,
 * around the route's own styled content. Selectors are role/label only (repo policy); no `data-testid`,
 * no `waitForTimeout`. Serial (Clerk-authed).
 */
test.use({ viewport: { width: 1280, height: 900 } });

test.describe('auth surface renders inside the app nav shell at desktop width (U3)', () => {
    test('the /account route mounts the desktop sidebar + top bar around its content', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/account'));

        // The route's own content renders…
        await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
        // …inside the shared chrome: the desktop sidebar (its collapse control is sidebar-only)…
        await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
        // …and the sticky top bar (its fixed page title).
        await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    });

    test('the /profile route mounts the desktop sidebar + top bar around its content', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/profile'));

        await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    });

    test('the /settings route mounts the desktop sidebar + top bar around its content', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/settings'));

        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
        // The sign-out control is the shared design-system Button (labelled, not a bare browser button).
        await expect(page.getByRole('button', { name: 'Sign out of your account' })).toBeVisible();
    });
});
