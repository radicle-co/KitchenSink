import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe ids as UUIDs: `addRecipeToCollectionRequestSchema.recipeId` is `z.uuid()` and the client parses outbound, so a
 * `rec_*` slug makes "add to collection" throw before any request (the trap `collections.spec.ts` documents).
 */
const RECIPE_IDS = {
    pasta: E2E_RECIPE_IDS.pasta,
    soup: E2E_RECIPE_IDS.lentilSoup,
} as const;

/**
 * The add-recipes picker (FR-009; `docs/design/uiOverhaul/buildSpec.md` §5.3), driven through the real web UI with the
 * recipe-service HTTP contract intercepted (`utils/recipeApi`). It is a sheet "Add to {name}" over the collection, not a
 * route: every toggle saves at once (a checkbox per recipe), Done says what changed, and a refused toggle flips back and
 * says so. Role/label selectors only; both colour schemes are walked, since the sheet and its rows are surfaces the dark
 * theme styles (D15).
 */
for (const scheme of ['light', 'dark'] as const) {
    test.describe(`the add-recipes picker (${scheme})`, () => {
        test.beforeEach(async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
        });

        test('adds a recipe at once, announces it, and Done says what changed', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [
                    makeRecipeDetail({ id: RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                    makeRecipeDetail({ id: RECIPE_IDS.soup, ownerId: viewerId, title: 'Lentil Soup' }),
                ],
                // An EMPTY collection — the picker is what puts a recipe in it.
                collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
            });

            await page.goto(route('/collections/col_dinners'));
            await expect(page.getByRole('heading', { name: 'No recipes here yet' })).toBeVisible();
            await page.getByRole('button', { name: 'Add recipes' }).first().click();

            // A sheet over the collection, named for it; the URL does not move.
            const sheet = page.getByRole('dialog', { name: 'Add to Weeknight dinners' });
            await expect(sheet).toBeVisible();
            await expect(page).toHaveURL(/\/collections\/col_dinners$/);
            const pasta = sheet.getByRole('checkbox', { name: 'Weeknight Pasta' });
            await expect(pasta).toHaveAttribute('aria-checked', 'false');

            // ADD — the row is checked at once, said politely, and Done counts it.
            await pasta.click();
            await expect(pasta).toHaveAttribute('aria-checked', 'true');
            await expect(sheet.getByRole('status').filter({ hasText: 'Added Weeknight Pasta' })).toBeAttached();
            await expect(sheet.getByRole('button', { name: 'Done · 1 added' })).toBeVisible();

            // DONE — back on the collection, the recipe is a member.
            await sheet.getByRole('button', { name: 'Done · 1 added' }).click();
            await expect(sheet).toHaveCount(0);
            await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toBeVisible();
            await expect(page.getByRole('heading', { name: 'No recipes here yet' })).toHaveCount(0);
        });

        test('shows the members already checked, removes one, and reads add then remove as no change', async ({
            page,
        }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [
                    makeRecipeDetail({ id: RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                    makeRecipeDetail({ id: RECIPE_IDS.soup, ownerId: viewerId, title: 'Lentil Soup' }),
                ],
                collections: [
                    makeCollection({
                        id: 'col_dinners',
                        ownerId: viewerId,
                        name: 'Weeknight dinners',
                        recipeIds: [RECIPE_IDS.pasta],
                    }),
                ],
            });

            await page.goto(route('/collections/col_dinners'));
            await page.getByRole('button', { name: 'Add recipes' }).first().click();
            const sheet = page.getByRole('dialog', { name: 'Add to Weeknight dinners' });
            const pasta = sheet.getByRole('checkbox', { name: 'Weeknight Pasta' });
            const soup = sheet.getByRole('checkbox', { name: 'Lentil Soup' });
            await expect(pasta).toHaveAttribute('aria-checked', 'true');
            await expect(soup).toHaveAttribute('aria-checked', 'false');

            // Add then remove the same recipe: nothing changed, and Done says so.
            await soup.click();
            await expect(soup).toHaveAttribute('aria-checked', 'true');
            await soup.click();
            await expect(soup).toHaveAttribute('aria-checked', 'false');
            await expect(sheet.getByRole('button', { name: 'Done', exact: true })).toBeVisible();

            // REMOVE a member from the sheet.
            await pasta.click();
            await expect(sheet.getByRole('button', { name: 'Done · 1 removed' })).toBeVisible();
            await sheet.getByRole('button', { name: 'Done · 1 removed' }).click();
            await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toHaveCount(0);
        });

        test('flips a refused toggle back and says so, leaving Done reachable', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [makeRecipeDetail({ id: RECIPE_IDS.soup, ownerId: viewerId, title: 'Lentil Soup' })],
                collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
            });
            // Registered after `mockRecipeApi`, so Playwright asks it first.
            await page.route(
                (url) => /\/api\/v1\/collections\/col_dinners\/recipes$/u.test(url.pathname),
                async (refused) => {
                    if (refused.request().method() === 'POST') {
                        await refused.fulfill({
                            status: 500,
                            contentType: 'application/json',
                            body: '{"code":"INTERNAL"}',
                        });

                        return;
                    }

                    await refused.fallback();
                },
            );

            await page.goto(route('/collections/col_dinners'));
            await page.getByRole('button', { name: 'Add recipes' }).first().click();
            const sheet = page.getByRole('dialog', { name: 'Add to Weeknight dinners' });
            const soup = sheet.getByRole('checkbox', { name: 'Lentil Soup' });
            await soup.click();

            await expect(sheet.getByText('Couldn’t add Lentil Soup. Try again.')).toBeVisible();
            await expect(soup).toHaveAttribute('aria-checked', 'false');
            await expect(sheet.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
        });

        test('narrows the rows by the search, and says when nothing matches', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [
                    makeRecipeDetail({ id: RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                    makeRecipeDetail({ id: RECIPE_IDS.soup, ownerId: viewerId, title: 'Lentil Soup' }),
                ],
                collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
            });

            await page.goto(route('/collections/col_dinners'));
            await page.getByRole('button', { name: 'Add recipes' }).first().click();
            const sheet = page.getByRole('dialog', { name: 'Add to Weeknight dinners' });
            await expect(sheet.getByRole('checkbox', { name: 'Lentil Soup' })).toBeVisible();

            const search = sheet.getByRole('searchbox', { name: 'Search your recipes' });
            await search.fill('soup');
            await expect(sheet.getByRole('checkbox', { name: 'Weeknight Pasta' })).toHaveCount(0);
            await expect(sheet.getByRole('checkbox', { name: 'Lentil Soup' })).toBeVisible();

            await search.fill('zzz');
            await expect(sheet.getByText('No recipes match your search')).toBeVisible();
        });

        test('says there are no recipes yet, and keeps Done reachable', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [],
                collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
            });

            await page.goto(route('/collections/col_dinners'));
            await page.getByRole('button', { name: 'Add recipes' }).first().click();
            const sheet = page.getByRole('dialog', { name: 'Add to Weeknight dinners' });

            await expect(sheet.getByText('You have no recipes yet.')).toBeVisible();
            await sheet.getByRole('button', { name: 'Done', exact: true }).click();
            await expect(sheet).toHaveCount(0);
        });
    });
}
