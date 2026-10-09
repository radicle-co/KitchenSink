import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Discover's three no-result states (`docs/design/uiOverhaul/buildSpec.md` §4.6), driven through the real web UI with the
 * recipe-service contract intercepted (`utils/recipeApi`). Which state shows depends on what narrowed the search: a term
 * alone names it ("No recipes for “zzz”") and offers Clear search; filters alone say so and offer Clear filters; both say
 * both. Each ends in the Trending rail, so the cook is never at a dead end, and the count line (one element, also the polite
 * live region) says the same title. Role/label selectors only; both colour schemes are walked (D15).
 */
for (const scheme of ['light', 'dark'] as const) {
    test.describe(`Discover with no results (${scheme})`, () => {
        test.beforeEach(async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
        });

        async function discoverWithRecipes(page: import('@playwright/test').Page): Promise<void> {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [
                    makeRecipeDetail({
                        id: E2E_RECIPE_IDS.paella,
                        ownerId: 'usr_other',
                        title: 'Seafood Paella',
                        visibility: 'public',
                    }),
                    makeRecipeDetail({
                        id: E2E_RECIPE_IDS.pasta,
                        ownerId: 'usr_other',
                        title: 'Weeknight Pasta',
                        visibility: 'public',
                    }),
                ],
            });
        }

        test('a search that finds nothing names the term, clears it, and ends in Trending', async ({ page }) => {
            await discoverWithRecipes(page);
            await page.goto(route('/discover'));

            await page.getByRole('searchbox', { name: 'Search recipes' }).fill('zzzzzz');

            await expect(page.getByRole('heading', { level: 2, name: 'No recipes for “zzzzzz”' })).toBeVisible();
            await expect(page.getByText('Check the spelling, or try a shorter search.')).toBeVisible();
            // The Trending rail is the one thing every no-result state ends in.
            await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();

            await page
                .getByRole('region', { name: 'Search results' })
                .getByRole('button', { name: 'Clear search' })
                .click();
            await expect(page.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('');
            await expect(page.getByRole('heading', { name: 'No recipes for “zzzzzz”' })).toHaveCount(0);
        });

        test('filters alone that match nothing say so, and Clear filters brings the results back', async ({ page }) => {
            await discoverWithRecipes(page);
            await page.goto(route('/discover?tags=nothing-has-this-tag'));

            await expect(page.getByRole('heading', { level: 2, name: 'No recipes match these filters' })).toBeVisible();
            await expect(page.getByText('Remove a filter to see more.')).toBeVisible();

            await page.getByRole('button', { name: 'Clear filters' }).click();

            await expect(page).not.toHaveURL(/tags=/);
            await expect(page.getByRole('heading', { name: 'No recipes match these filters' })).toHaveCount(0);
        });

        test('a term with filters names both', async ({ page }) => {
            await discoverWithRecipes(page);
            await page.goto(route('/discover?tags=nothing-has-this-tag'));

            await page.getByRole('searchbox', { name: 'Search recipes' }).fill('zzzzzz');

            await expect(
                page.getByRole('heading', { level: 2, name: 'No recipes for “zzzzzz” with these filters' }),
            ).toBeVisible();
            const results = page.getByRole('region', { name: 'Search results' });
            await expect(results.getByRole('button', { name: 'Clear search' })).toBeVisible();
            await expect(results.getByRole('button', { name: 'Clear filters' })).toBeVisible();
        });

        test('the count line and the no-result state say the same title', async ({ page }) => {
            await discoverWithRecipes(page);
            await page.goto(route('/discover'));

            await page.getByRole('searchbox', { name: 'Search recipes' }).fill('zzzzzz');

            // Two polite regions say it: the frame's count line (mounted empty, so a change is announced) and the no-result
            // state itself, which is a status region of its own and carries the heading.
            const statuses = page.getByRole('status').filter({ hasText: 'No recipes for “zzzzzz”' });
            await expect(statuses).toHaveCount(2);
            await expect(statuses.first()).toHaveText('No recipes for “zzzzzz”');
        });
    });
}
