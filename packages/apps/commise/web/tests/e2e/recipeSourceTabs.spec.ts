import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The recipe-SOURCE switcher round trip (L5), through the real browser (Next dev server + Clerk session +
 * client hooks + real routing), with the recipe-service HTTP contract intercepted (`utils/recipeApi`).
 *
 * ## Why this spec exists
 *
 * This is the assertion that would have caught the owner-reported dead end. `/recipes` rendered the switcher
 * and pushed `/discover`; `/discover` rendered a heading and NOTHING else — no switcher, no way back — while
 * every component test passed, because each surface was only ever tested on its own. A one-way trip is
 * invisible to a per-surface test and obvious to a round trip, so the round trip is what gets asserted here:
 * `/recipes` → Community → back to My Recipes, LANDING on `/recipes`.
 *
 * The second test pins the semantics the fix depends on: these are links with real `href`s, so ⌘/middle-click
 * opens a source in a new tab instead of doing nothing. A `<button onClick={router.push}>` — what the strip
 * used to be — cannot satisfy it.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
test.describe('recipe source switcher — the /recipes ⇄ /discover round trip (L5)', () => {
    test('returns to My Recipes from the Community surface, landing on /recipes', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [makeRecipeDetail({ id: 'rec_own', ownerId: viewerId, title: 'Weeknight Pasta' })],
        });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        const switcher = page.getByRole('navigation', { name: 'Recipe source' });
        await expect(switcher.getByRole('link', { name: 'My Recipes' })).toHaveAttribute('aria-current', 'page');

        // ── outbound ──────────────────────────────────────────────────────────────────────────────────
        await switcher.getByRole('link', { name: 'Community' }).click();

        await expect(page).toHaveURL(/\/discover(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();

        // The switcher is STILL there, now with Community as the current source — the half that was missing.
        const backSwitcher = page.getByRole('navigation', { name: 'Recipe source' });
        await expect(backSwitcher.getByRole('link', { name: 'Community' })).toHaveAttribute('aria-current', 'page');

        // ── return ────────────────────────────────────────────────────────────────────────────────────
        await backSwitcher.getByRole('link', { name: 'My Recipes' }).click();

        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        // Landing on the real library, not merely on the URL: the viewer's own recipe is back on screen.
        await expect(page.getByRole('button', { name: 'Weeknight Pasta' })).toBeVisible();
        await expect(
            page.getByRole('navigation', { name: 'Recipe source' }).getByRole('link', { name: 'My Recipes' }),
        ).toHaveAttribute('aria-current', 'page');
    });

    test('exposes both sources as real links with real hrefs (not push-buttons)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        // This is the whole of what the owner called out as lost — ⌘/middle-click, "open in new tab", the
        // status-bar target preview — and all of it follows from the element BEING an `<a href>` in the real
        // rendered document. What is asserted is therefore the element and its target, not the browser's own
        // tab-opening behaviour (which is the browser's guarantee for a link, and a flaky thing to re-verify).
        // A `<button onClick={router.push}>`, which this strip used to be, satisfies neither locator.
        const switcher = page.getByRole('navigation', { name: 'Recipe source' });

        await expect(switcher.getByRole('link', { name: 'Community' })).toHaveAttribute('href', /\/discover$/);
        await expect(switcher.getByRole('link', { name: 'My Recipes' })).toHaveAttribute('href', /\/recipes$/);
        await expect(switcher.getByRole('button')).toHaveCount(0);
    });
});
