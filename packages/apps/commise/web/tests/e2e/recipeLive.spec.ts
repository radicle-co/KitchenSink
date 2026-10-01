import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * Live-backend smoke: the web recipe UI against the REAL recipe-service + identity-service, with NO route
 * mocks. The sibling recipe specs intercept the HTTP contract (fast, hermetic); this one exercises the full
 * cross-origin path — CORS, the client hooks minting a real Clerk token, the recipe list read, and
 * owner-gating driven by the live `/api/v1/users/me` viewer id. It requires recipe-local + identity-local up
 * with the dev-bypass owner + seed aligned to the test user's app id (see the local-e2e setup), so it is
 * OPT-IN: run only when `E2E_LIVE_BACKEND=1`, and point `PLAYWRIGHT_BASE_URL` at the running dev server.
 */
const LIVE = process.env['E2E_LIVE_BACKEND'] === '1';

test.describe('recipe live backend (no mocks)', () => {
    test.skip(!LIVE, 'set E2E_LIVE_BACKEND=1 with recipe-local + identity-local running');

    test('lists the caller’s seeded recipes and gates owner actions on the detail', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        // Seeded recipes owned by the caller — served live by recipe-local (dev-bypass owner == the test
        // user's app id). Cards expose the title as an actionable control's accessible name.
        await expect(page.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Asparagus with Green Sauce' })).toBeVisible();

        // Open a detail: the owner-only Delete action renders ONLY when the live identity `/api/v1/users/me`
        // resolves the viewer id AND it matches the recipe's owner — the end-to-end owner-gating proof. It
        // sits behind the "More" overflow menu (C4).
        await page.getByRole('button', { name: 'Mediterranean Grilled Lamb' }).click();
        await expect(page.getByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toBeVisible();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Delete recipe' })).toBeVisible();
    });
});
