import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Save a copy from a Discover card (`docs/design/uiOverhaul/buildSpec.md` §4.1; owner decision "Clone becomes Save a copy,
 * and stays on Discover cards as an icon"), driven through the real web UI with the recipe-service contract intercepted
 * (`utils/recipeApi`). The card is one link named by the recipe, and the 44 px icon button beside the author is its own
 * control, lifted above the link so one press cannot do both. Pressing it makes a copy and says so in a snackbar whose
 * Edit action opens the COPY in the editor (a copy is published only after an edit, FR-005b); the control then reads
 * "Saved". Role/label selectors only; both colour schemes are walked (D15).
 *
 * The recipe page's own Save a copy is `cloneVisibility.spec.ts`'s (slice 6).
 */
for (const scheme of ['light', 'dark'] as const) {
    test.describe(`Save a copy from Discover (${scheme})`, () => {
        test.beforeEach(async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
        });

        test('makes a copy, says so, and Edit opens the copy', async ({ page }) => {
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
                ],
            });

            await page.goto(route('/discover'));
            await page.getByRole('searchbox', { name: 'Search recipes' }).fill('paella');
            // The results, not the rails: one recipe sits in Trending, New and Quick at once, so a card locator is
            // ambiguous until the count line says the search for the term has settled.
            await expect(page.getByText('1 recipe for “paella”', { exact: true })).toBeVisible();
            await expect(page.getByRole('link', { name: 'Seafood Paella' })).toBeVisible();

            await page.getByRole('button', { name: 'Save a copy of Seafood Paella' }).click();

            // The snackbar says it, and the control says it too. Nothing has opened by itself.
            await expect(page.getByText('Saved a copy to My recipes.')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Saved a copy of Seafood Paella' })).toBeVisible();
            await expect(page).toHaveURL(/\/discover/);

            // Edit opens the COPY in the editor.
            await page.getByRole('button', { name: 'Edit' }).click();
            await expect(page).toHaveURL(/\/recipes\/rec_clone_[^/]+\/edit/);
        });

        test('pressing the control does not open the recipe, and the card still does', async ({ page }) => {
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
                ],
            });

            await page.goto(route('/discover'));
            await page.getByRole('searchbox', { name: 'Search recipes' }).fill('paella');
            await expect(page.getByText('1 recipe for “paella”', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Save a copy of Seafood Paella' }).click();
            await expect(page.getByText('Saved a copy to My recipes.')).toBeVisible();
            // One press made a copy and did nothing else: still on Discover.
            await expect(page).toHaveURL(/\/discover/);

            await page.getByRole('link', { name: 'Seafood Paella', exact: true }).click();
            await expect(page).toHaveURL(new RegExp(`/recipes/${E2E_RECIPE_IDS.paella}$`, 'u'));
        });

        test('a collection’s Save a copy lands on the copy', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [
                    makeRecipeDetail({
                        id: E2E_RECIPE_IDS.pasta,
                        ownerId: viewerId,
                        title: 'Weeknight Pasta',
                        visibility: 'public',
                    }),
                ],
                collections: [
                    {
                        id: 'col_source',
                        ownerId: viewerId,
                        name: 'Sunday Suppers',
                        visibility: 'public',
                        recipeIds: [E2E_RECIPE_IDS.pasta],
                        createdAt: '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-01T00:00:00.000Z',
                    },
                ],
            });

            await page.goto(route('/collections/col_source'));
            await page.getByRole('button', { name: 'More actions for Sunday Suppers' }).click();
            await page.getByRole('menuitem', { name: 'Save a copy' }).click();

            await expect(page).toHaveURL(/\/collections\/col_clone_/);
            await expect(page.getByRole('heading', { level: 1, name: 'Sunday Suppers' })).toBeVisible();
        });
    });
}
