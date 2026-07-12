import { test, expect } from '@playwright/test';

import { isHome, pathnameOf } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * E2E for the recipe Home widget (feature 001) mounted on the signed-in home page. `signInWithTicket`
 * establishes a real session and lands on `/`; the widget then renders its card. recipe-service is not
 * yet reachable from the preview, so the widget streams to its empty state deterministically — this
 * proves the widget is integrated into the app and renders end-to-end in a browser. When recipe data is
 * wired (see web/src/lib/recipes.ts), extend this to assert populated recipe rows.
 */
test.describe('recipe Home widget', () => {
    test('renders the recent-recipes card (empty state) on the signed-in home page', async ({ page }) => {
        await signInWithTicket(page);

        await expect.poll(() => isHome(pathnameOf(page)), { timeout: 15_000 }).toBe(true);

        // The widget card shell is on Home.
        await expect(page.getByText('Recent recipes')).toBeVisible();
        // With no recipes reachable yet it streams to the empty state (not the skeleton, not a crash).
        await expect(page.getByText(/no recipes yet/i)).toBeVisible();
    });
});
