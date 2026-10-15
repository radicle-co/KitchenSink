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
 * Since plan 2026-10-15-011 it also proves the live statuses: each row says what the server reports its line is doing,
 * one progress block says where the paste is, and a paste the server calls stalled waits on the cook (no time limit)
 * until Add the rest as written joins it.
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
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
            await openNewRecipe(page);
            const ingredients = editorSection(page, 'Ingredients');

            await ingredients.getByRole('button', { name: 'Paste a list' }).click();
            const sheet = page.getByRole('dialog', { name: 'Paste a list' });
            const add = sheet.getByRole('button', { name: /^Add \d+ ingredients?$/u });
            await expect(add).toBeDisabled();

            await sheet.getByRole('textbox', { name: 'Ingredient lines' }).fill('2 cups flour\n\n1 tsp salt');
            await expect(sheet.getByText('2 lines')).toBeVisible();
            await sheet.getByRole('button', { name: 'Add 2 ingredients' }).click();

            // The sheet closes once the job is accepted, and each line is a row of its own list at once, saying what the
            // server reports it is doing, under the one progress block (plan 2026-10-15-011).
            await expect(sheet).toHaveCount(0);
            const pasted = ingredients.getByRole('list', { name: 'Lines not added yet' });
            await expect(pasted.getByRole('listitem').filter({ hasText: '2 cups flour' })).toBeVisible();
            await expect(ingredients.getByText('Added 0 of 2 lines')).toBeVisible();

            // ⛔ THE POLL, not a click: nothing below touches the page.
            await expect(pasted).toHaveCount(0, { timeout: POLL_SETTLE_TIMEOUT_MS });
            await expect(page.getByRole('status').filter({ hasText: 'Added 2 ingredients.' })).toHaveCount(1);
            // Paste is offered once more, now in the section's heading row.
            await expect(ingredients.getByRole('button', { name: 'Paste a list' })).toBeVisible();
        });

        test('the recipe’s create carries what each pasted line was read from (A5)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
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

        test('⛔ a stalled paste waits on the cook, with no time limit; Add the rest as written joins it', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            // The server keeps reporting both lines stalled: the paste never settles by itself.
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: { pendingPhase: 'stalled', pollsBeforeSettled: 1_000 },
            });
            await openNewRecipe(page);
            const ingredients = editorSection(page, 'Ingredients');

            await ingredients.getByRole('button', { name: 'Paste a list' }).click();
            const sheet = page.getByRole('dialog', { name: 'Paste a list' });
            await sheet.getByRole('textbox', { name: 'Ingredient lines' }).fill('2 cups flour\n1 tsp salt');
            await sheet.getByRole('button', { name: 'Add 2 ingredients' }).click();

            const pasted = ingredients.getByRole('list', { name: 'Lines not added yet' });
            await expect(pasted.getByText('Taking longer than usual')).toHaveCount(2, {
                timeout: POLL_SETTLE_TIMEOUT_MS,
            });
            await expect(ingredients.getByText('You can keep waiting, or add the lines as written.')).toBeVisible();
            await expect(pasted.getByRole('button', { name: 'Add as written: 2 cups flour' })).toBeVisible();

            await ingredients.getByRole('button', { name: 'Add the rest as written: 2 lines' }).click();

            await expect(pasted).toHaveCount(0, { timeout: POLL_SETTLE_TIMEOUT_MS });
            await expect(page.getByRole('status').filter({ hasText: 'Added 2 ingredients.' })).toHaveCount(1);
        });

        test('a line the system stopped reading offers Try again for the whole paste', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', parseJob: { settlesAs: 'partial' } });
            await openNewRecipe(page);
            const ingredients = editorSection(page, 'Ingredients');

            await ingredients.getByRole('button', { name: 'Paste a list' }).click();
            const sheet = page.getByRole('dialog', { name: 'Paste a list' });
            await sheet.getByRole('textbox', { name: 'Ingredient lines' }).fill('2 cups flour\n1 tsp salt');
            await sheet.getByRole('button', { name: 'Add 2 ingredients' }).click();

            const pasted = ingredients.getByRole('list', { name: 'Lines not added yet' });
            await expect(pasted.getByText('Couldn’t read this line')).toBeVisible({ timeout: POLL_SETTLE_TIMEOUT_MS });
            await expect(ingredients.getByText('1 line needs you')).toBeVisible();

            const retried = page.waitForRequest(
                (request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/retry'),
            );
            await ingredients.getByRole('button', { name: 'Try again for 1 line' }).click();
            await retried;

            // The mock's retry recovers the job (one-shot partial), so the last line joins too.
            await expect(pasted).toHaveCount(0, { timeout: POLL_SETTLE_TIMEOUT_MS });
        });

        test('⛔ a stored recipe offers no paste anywhere (D10)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                recipes: [
                    makeRecipeDetail({
                        id: 'ec000000-0000-4000-8000-000000000017',
                        ownerId: viewerId,
                        title: 'Weeknight Pasta',
                    }),
                ],
            });

            await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000017/edit'));
            await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();

            await expect(page.getByRole('button', { name: 'Paste a list' })).toHaveCount(0);
        });
    });
}
