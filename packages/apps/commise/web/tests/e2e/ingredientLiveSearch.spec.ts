import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * U29 — the ON-DEMAND source search's user story, driven through the real create wizard (Next dev server +
 * Clerk session + client hooks + routing) with the recipe-service HTTP contract intercepted.
 *
 * Playwright IS this feature's UI integration test (repo testing policy), so what it proves is the part no
 * component test can: that the real press → `GET /api/v1/ingredients/search/live` → render → tap →
 * `POST /api/v1/ingredients/by-food` → resolved-line round trip holds through the live client, the live
 * mutation cache and the real wizard — and that the line it produces is good enough to PUBLISH with, which
 * is the falsifiable end of the story.
 *
 * ⛔ It also asserts the property the whole design rests on, at the only layer where a real network is
 * involved: **typing sends nothing.** The upstream source allows 1,000 requests/hour PER IP, shared by
 * every cook, and only the top 10% is reserved for user-facing work — so at 50 concurrent cooks a
 * per-settled-query autocomplete would want roughly three times the entire key. Here the request count is
 * observed directly, so a regression that wired the control to a debounce fails on the number rather than
 * on anything cosmetic.
 *
 * Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('on-demand USDA search from the ingredient picker (U29)', () => {
    test('does not search while typing, searches on press, and the picked hit publishes', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        // Count the live-search requests the app actually issues. `mockRecipeApi` already fulfils them; this
        // observer runs first and passes the request through, so the count is of REAL traffic.
        let liveSearchRequests = 0;
        await page.route('**/api/v1/ingredients/search/live**', async (routed) => {
            liveSearchRequests += 1;
            await routed.fallback();
        });

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Peppered Broth');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients).
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('pepper');

        // Waiting on the LOCAL results is what makes the next assertion meaningful: the debounce has fired,
        // the typeahead has been served, and the app has had every chance to also fire a live search.
        await expect(page.getByRole('region', { name: 'Food catalog' })).toBeVisible();

        const searchUsda = page.getByRole('button', { name: /Search USDA for/u });
        await expect(searchUsda).toBeVisible();
        // ⛔ THE property. Six keystrokes, a settled local search, and nothing has left for the source.
        expect(liveSearchRequests).toBe(0);

        await searchUsda.click();

        // The source section appears as its own labelled region, appended BELOW the local ones — which stay.
        const usdaSection = page.getByRole('region', { name: 'USDA search results' });
        await expect(usdaSection).toBeVisible();
        await expect(page.getByRole('region', { name: 'Food catalog' })).toBeVisible();
        expect(liveSearchRequests).toBe(1);

        // Picking a hit we already hold admits it through `by-food` and lands a real, resolved line.
        await usdaSection.getByRole('button', { name: 'Pepper, black, ground' }).click();
        await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Pepper, black, ground');
        await expect(page.getByLabel('Ingredient 1 status')).toHaveText('Resolved');

        // …and it is a real catalog id, so the recipe publishes — Publish validation rejects a line whose
        // `ingredientId` does not resolve, so this is what proves the pick produced something usable rather
        // than something that merely rendered.
        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Simmer, then season generously.');
        await page.getByRole('button', { name: 'Next: Review' }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Peppered Broth' })).toBeVisible();
        // One live search for the whole journey. A regression that re-searched on every keystroke, on
        // re-render, or on the pick would show up here as a number rather than as a visual difference.
        expect(liveSearchRequests).toBe(1);
    });
});
