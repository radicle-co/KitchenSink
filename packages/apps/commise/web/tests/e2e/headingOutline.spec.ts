import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The heading outline of the pages that list cards (`docs/design/uiOverhaul/buildSpec.md` §4.1 "Card title is H3 on a
 * sectioned page", W-09): a card is one level below the heading it sits under. A results list straight under the
 * page's H1 has H2 cards; a card under a section's H2 (a Discover rail, Home's Recent recipes) is an H3. A page whose
 * cards were all H3 under an H1 skipped a level (WCAG 1.3.1 / the outline a screen-reader user navigates by).
 *
 * Driven through the real web UI with the recipe-service contract intercepted. Selectors are role/label only.
 */
test.describe('heading outline of the card lists (W-09)', () => {
    test('My recipes: one H1, and the cards are H2 beneath it with no H3 in between', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({ id: 'ec000000-0000-4000-8000-000000000031', ownerId: viewerId, title: 'Soup' }),
                makeRecipeDetail({ id: 'ec000000-0000-4000-8000-000000000032', ownerId: viewerId, title: 'Pasta' }),
            ],
        });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('link', { name: 'Soup' })).toBeVisible();

        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByRole('article', { name: 'Soup' }).getByRole('heading', { level: 2 })).toBeVisible();
        await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveCount(0);
    });

    test('Discover: the results are H2 under the H1, and a rail’s cards are H3 under the rail’s H2', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'ec000000-0000-4000-8000-000000000033', ownerId: 'usr_other', title: 'Paella' }),
            ],
        });

        await page.goto(route('/discover'));
        const trending = page.getByRole('heading', { level: 2, name: 'Trending' });
        await expect(trending).toBeVisible();

        // A rail card sits under the rail's H2, so it is an H3.
        await expect(
            page.getByRole('article', { name: 'Paella' }).first().getByRole('heading', { level: 3 }),
        ).toBeVisible();

        // A search replaces the rails with results straight under the H1, so those cards are H2.
        await page.getByRole('searchbox', { name: 'Search recipes' }).fill('paella');
        await expect(page.getByText('1 recipe for “paella”', { exact: true })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Paella' }).getByRole('heading', { level: 2 })).toBeVisible();
    });

    test('Collections: the collection cards are H2 under the page’s H1', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [],
            collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight Dinners' })],
        });

        await page.goto(route('/collections'));
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByRole('heading', { level: 2, name: 'Weeknight Dinners' })).toBeVisible();
        await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveCount(0);
    });

    test('Home: the recent recipes are H3 under the widget’s H2', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'free',
            recipes: [
                makeRecipeDetail({ id: 'ec000000-0000-4000-8000-000000000034', ownerId: viewerId, title: 'Soup' }),
            ],
        });

        await page.goto(route('/'));
        await expect(page.getByRole('heading', { level: 2, name: 'Recent recipes' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Soup' }).getByRole('heading', { level: 3 })).toBeVisible();
    });
});
