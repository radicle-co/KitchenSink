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
 *
 * The top-bar probe is each route's OWN title. It used to be the hard-coded 'Home' the bar showed on every
 * shell route — the defect these assertions now guard against returning. It is scoped to the `banner` landmark
 * and matched as text, because the bar's title is deliberately not a heading (the page content owns the `h1`,
 * and on these three routes the bar's title would otherwise be a second heading with a colliding name).
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
        // …and the sticky top bar, titled for THIS surface.
        await expect(page.getByRole('banner').getByText('Account')).toBeVisible();
        await expect(page.getByRole('banner').getByText('Home')).toHaveCount(0);
    });

    test('the /profile route mounts the desktop sidebar + top bar around its content', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/profile'));

        // The page's own h1 is 'Profile' — and it is the ONLY heading by that name, because the top bar's
        // matching title is plain text rather than a duplicate heading.
        await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
        await expect(page.getByRole('banner').getByText('Profile')).toBeVisible();
        await expect(page.getByRole('banner').getByText('Home')).toHaveCount(0);
    });

    test('the /settings route mounts the desktop sidebar + top bar around its content', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/settings'));

        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
        await expect(page.getByRole('banner').getByText('Settings')).toBeVisible();
        await expect(page.getByRole('banner').getByText('Home')).toHaveCount(0);
        // The sign-out control is the shared design-system Button (labelled, not a bare browser button).
        await expect(page.getByRole('button', { name: 'Sign out of your account' })).toBeVisible();
    });
});
