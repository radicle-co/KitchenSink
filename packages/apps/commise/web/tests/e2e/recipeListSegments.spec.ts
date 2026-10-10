import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The Recipes screen's two places (`docs/design/uiOverhaul/buildSpec.md` §4.3, §5.1): My recipes and Collections, as
 * route segments — real links in a navigation named "Recipes", the current one `aria-current="page"`, each leading to
 * the other and back. Discover is its own destination, so the old My Recipes / Community switcher is gone, and this
 * spec replaces `recipeSourceTabs.spec.ts` (deleted with it, per the slice 4 entry in §13).
 *
 * Selectors are role/label only. Serial (Clerk-authed).
 */
test.describe('Recipes segments — My recipes and Collections', () => {
    test('are real links, the current one marked, and each leads to the other and back', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-00000000002d',
                    ownerId: viewerId,
                    title: 'Weeknight Pasta',
                }),
            ],
        });

        await page.goto(route('/recipes'));
        const segments = page.getByRole('navigation', { name: 'Recipes' });

        await expect(segments.getByRole('link', { name: 'My recipes' })).toHaveAttribute('aria-current', 'page');
        await expect(segments.getByRole('link', { name: 'My recipes' })).toHaveAttribute('href', /\/recipes$/);
        await expect(segments.getByRole('link', { name: 'Collections' })).toHaveAttribute('href', /\/collections$/);
        await expect(segments.getByRole('button')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Weeknight Pasta' })).toBeVisible();

        await segments.getByRole('link', { name: 'Collections' }).click();
        await expect(page).toHaveURL(/\/collections$/);

        const back = page.getByRole('navigation', { name: 'Recipes' });
        await expect(back.getByRole('link', { name: 'Collections' })).toHaveAttribute('aria-current', 'page');

        await back.getByRole('link', { name: 'My recipes' }).click();
        await expect(page).toHaveURL(/\/recipes$/);
        await expect(page.getByRole('link', { name: 'Weeknight Pasta' })).toBeVisible();
    });
});
