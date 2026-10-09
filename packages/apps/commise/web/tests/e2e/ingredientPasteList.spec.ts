import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { editorSection, openNewRecipe } from './utils/recipeEditor';

/**
 * Paste a list in the editor's Ingredients section (build spec §7.5.4; blueprint A5; owner decision D10; UI overhaul
 * slice 8), through the real browser, in both themes (D15), with the recipe-service contract intercepted. REPLACES
 * `parseIngredients.spec.ts`: the paste page and its review page are retired, and the flow ends inside the recipe.
 *
 * What only this tier proves: the POLL advances the rows on its own (the mock answers `running` once, then settles), the
 * pasted lines join the draft through the real lookup, and the recipe's CREATE carries what each line was read from.
 *
 * Selectors are role and label only; every wait is on a settled state, never a timeout.
 */
const SCHEMES = ['light', 'dark'] as const;

/** Bound for an assertion that must outlast a poll or two (`DEFAULT_PARSE_JOB_POLL_INTERVAL_MS` is 4 s). */
const POLL_SETTLE_TIMEOUT_MS = 20_000;

for (const colorScheme of SCHEMES) {
    test.describe(`Paste a list (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
        });

        test('a new recipe’s empty section offers it; the lines read, then join the recipe', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });
            await openNewRecipe(page);
            const ingredients = editorSection(page, 'Ingredients');

            await ingredients.getByRole('button', { name: 'Paste a list' }).click();
            const sheet = page.getByRole('dialog', { name: 'Paste a list' });
            const add = sheet.getByRole('button', { name: /^Add \d+ ingredients?$/u });
            await expect(add).toBeDisabled();

            await sheet.getByRole('textbox', { name: 'Ingredient lines' }).fill('2 cups flour\n\n1 tsp salt');
            await expect(sheet.getByText('2 lines')).toBeVisible();
            await sheet.getByRole('button', { name: 'Add 2 ingredients' }).click();

            // The sheet closes once the job is accepted, and each line is a row of the list at once, reading.
            await expect(sheet).toHaveCount(0);
            const list = ingredients.getByRole('list', { name: 'Ingredients' });
            await expect(list.getByRole('listitem').filter({ hasText: '2 cups flour' })).toBeVisible();

            // ⛔ THE POLL, not a click: nothing below touches the page.
            await expect(list.getByText('Reading…')).toHaveCount(0, { timeout: POLL_SETTLE_TIMEOUT_MS });
            await expect(page.getByRole('status').filter({ hasText: 'Added 2 ingredients.' })).toHaveCount(1);
            // Paste is offered once more, now in the section's heading row.
            await expect(ingredients.getByRole('button', { name: 'Paste a list' })).toBeVisible();
        });

        test('the recipe’s create carries what each pasted line was read from (A5)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });
            await openNewRecipe(page);
            const ingredients = editorSection(page, 'Ingredients');

            await ingredients.getByRole('button', { name: 'Paste a list' }).click();
            const sheet = page.getByRole('dialog', { name: 'Paste a list' });
            await sheet.getByRole('textbox', { name: 'Ingredient lines' }).fill('2 cups flour');
            await sheet.getByRole('button', { name: 'Add 1 ingredient' }).click();
            // The line has joined the draft once the paste says so (a count of "Reading…" is zero before it starts).
            await expect(page.getByRole('status').filter({ hasText: 'Added 1 ingredient.' })).toHaveCount(1, {
                timeout: POLL_SETTLE_TIMEOUT_MS,
            });

            // The recipe has no server row yet: its first checkpoint after a title (a section change, A3) creates it.
            const created = page.waitForRequest(
                (request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api/v1/recipes'),
            );
            await page.getByLabel('Title').fill('Pasted Bread');
            await page
                .getByRole('navigation', { name: 'Recipe sections' })
                .getByRole('link', { name: 'Steps' })
                .click();
            const body = (await created).postDataJSON() as {
                readonly ingredients: readonly { readonly sourceLine?: string }[];
            };

            expect(body.ingredients.map((line) => line.sourceLine)).toEqual(['2 cups flour']);
        });

        test('⛔ a stored recipe offers no paste anywhere (D10)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                tier: 'premium',
                recipes: [makeRecipeDetail({ id: 'rec_own', ownerId: viewerId, title: 'Weeknight Pasta' })],
            });

            await page.goto(route('/recipes/rec_own/edit'));
            await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();

            await expect(page.getByRole('button', { name: 'Paste a list' })).toHaveCount(0);
        });
    });
}
