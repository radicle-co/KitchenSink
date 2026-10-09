import { expect, test, type Page } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi, ownFoodLedger, type MockFoodApiOptions } from './utils/foodApi';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * REWRITTEN for plan 002 S7.8: the ingredient search when part of it cannot answer
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P6; `docs/design/ingredientSpecialization.md` §S13 P6 to
 * P9), through the real web app with the recipe contract and food's progressive search intercepted.
 *
 * Each database group fails on its own: the list shows what the other group found and says, in a sentence, which was
 * not searched. Only an answer from BOTH groups may say that no food matches. A source that could not be searched says
 * so by name, and the cook's own limit says until when. A refused search (food's per-minute limit included) reads as
 * the search failing, never as the cook's lookup limit. Offline, the list says it is waiting for a connection, and
 * fills in once the connection is back. In every state the ways to fill a name that is not listed stay.
 *
 * The search runs from a declared line's own field (SPECIFY.1 row 2), an entry field on the edit form. What only this
 * tier proves: a real browser's stream, a real `429` and a real offline switch reach the list as these sentences. The
 * per-state rules are pinned by the component tests (`RecipeIngredientsFields.rowEditor.test.tsx`, `entryCombobox`).
 * Selectors are role, label and text only.
 */
const RECIPE_ID = 'rec_search_degraded';
const MY_PAPRIKA = { id: 'food_my_paprika', name: 'smoked paprika, my blend', score: 0.8 } as const;
const CATALOG_PAPRIKA = { id: 'food_paprika', name: 'Spices, paprika', score: 0.9 } as const;

const CATALOG_DOWN = 'The food catalog is unavailable right now, so only your foods were searched.';
const AUTHORED_DOWN = 'Your foods are unavailable right now, so only the food catalog was searched.';
const FAILED = 'We couldn’t search ingredients. Edit your search to try again.';
const NO_MATCH =
    'Nothing in your foods or the food catalog matches “paprika”. Keep typing, or find its nutrition by name.';

const savedRecipe = (viewerId: string): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Paprika chicken',
        status: 'draft',
        currentVersion: 1,
        ingredients: [
            {
                ingredientId: '55555555-5555-4555-8555-555555555551',
                name: 'paprika',
                quantity: { kind: 'exact', value: 1 },
                unit: 'tsp',
                isUserEntered: true,
            },
        ],
    });

/** The paprika the two database groups hold, unless a case says otherwise. */
const PAPRIKA_FOODS: MockFoodApiOptions = { catalog: () => [CATALOG_PAPRIKA], authored: ownFoodLedger([MY_PAPRIKA]) };

/** Sign in, stub both services, run `setUp`, and open the declared line's own list on its text. */
async function openTheList(
    page: Page,
    food: MockFoodApiOptions,
    setUp: (page: Page) => Promise<void> = async () => {},
) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId)] });
    await mockFoodApi(page, food);
    await setUp(page);

    await openRecipeEditor(page, RECIPE_ID);
    const field = page.getByRole('combobox', { name: 'Ingredient 1 name' });

    await field.click();
    await field.press('ArrowDown');

    return page.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });
}

test.describe('the ingredient search when part of it cannot answer (S7 list contract P6)', () => {
    test('both groups answer: the cook’s own foods, then the catalog’s, then Not listed?', async ({ page }) => {
        const list = await openTheList(page, PAPRIKA_FOODS);

        await expect(list.getByRole('group')).toHaveText([/^Your foods/u, /^Food catalog/u, /^Not listed\?/u]);
        await expect(list.getByRole('option', { name: `${MY_PAPRIKA.name}, your food` })).toBeVisible();
    });

    test('the catalog is down: the cook’s own foods, and its sentence, never “no foods match”', async ({ page }) => {
        const list = await openTheList(page, { ...PAPRIKA_FOODS, unavailable: ['catalog'] });

        await expect(page.getByText(CATALOG_DOWN, { exact: true })).toBeVisible();
        await expect(list.getByRole('group', { name: 'Your foods' })).toBeVisible();
        await expect(list.getByRole('group', { name: 'Food catalog' })).toHaveCount(0);
        await expect(list.getByRole('group', { name: 'Not listed?' })).toBeVisible();
        await expect(page.getByText(NO_MATCH)).toHaveCount(0);
    });

    test('the cook’s own foods are down: the catalog’s foods, and their own sentence', async ({ page }) => {
        const list = await openTheList(page, { ...PAPRIKA_FOODS, unavailable: ['authored'] });

        await expect(page.getByText(AUTHORED_DOWN, { exact: true })).toBeVisible();
        await expect(list.getByRole('group', { name: 'Food catalog' })).toBeVisible();
        await expect(list.getByRole('group', { name: 'Your foods' })).toHaveCount(0);
    });

    test('nothing could be searched: the search failed, said as an alert, and the ways on stay', async ({ page }) => {
        const list = await openTheList(page, { ...PAPRIKA_FOODS, unavailable: ['authored', 'catalog'] });

        await expect(page.getByRole('alert').filter({ hasText: FAILED })).toHaveCount(1);
        await expect(list.getByRole('option', { name: 'Use “paprika” as written, without nutrition' })).toBeVisible();
    });

    test('both groups answer with nothing: then, and only then, no foods match', async ({ page }) => {
        await openTheList(page, { catalog: () => [] });

        await expect(page.getByText(NO_MATCH).first()).toBeVisible();
    });

    test('a source that could not be searched says so by name, under the foods that did arrive', async ({ page }) => {
        const list = await openTheList(page, {
            ...PAPRIKA_FOODS,
            sources: () => [{ source: 'usda', outcome: 'busy', retryAfterSeconds: 30 }],
        });

        await expect(list.getByRole('group', { name: 'Food catalog' })).toBeVisible();
        await expect(page.getByText('We couldn’t search USDA just now. Try again later.').first()).toBeVisible();
    });

    test('the cook’s own lookup limit says until when, and which source it skipped', async ({ page }) => {
        await openTheList(page, {
            ...PAPRIKA_FOODS,
            sources: () => [{ source: 'usda', outcome: 'limited', retryAfterSeconds: 600 }],
        });

        await expect(
            page
                .getByText(/^You’ve reached your limit for food lookups until .+, so we didn’t search USDA\.$/u)
                .first(),
        ).toBeVisible();
    });

    test('food’s search limit reads as the search failing, not as the cook’s lookup limit', async ({ page }) => {
        await openTheList(page, PAPRIKA_FOODS, async (stubbed) => {
            await stubbed.route('**/api/v1/foods/search/progressive?**', (intercepted) =>
                intercepted.fulfill({
                    status: 429,
                    headers: { 'retry-after': '30' },
                    json: { code: 'SEARCH_RATE_LIMITED', message: 'slow down', details: { retryAfterSeconds: 30 } },
                }),
            );
        });

        await expect(page.getByRole('alert').filter({ hasText: FAILED })).toHaveCount(1);
        await expect(page.getByText(/reached your limit/u)).toHaveCount(0);
    });

    test('offline: the list waits for a connection, then fills in by itself (§S13 P9)', async ({ page, context }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        let online = true;

        await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId)] });
        await mockFoodApi(page, PAPRIKA_FOODS);
        // A route answers before the network does, so offline the double would still answer: food's requests fail as
        // the browser fails them while it is offline, and reach the double once it is back.
        await page.route('**/api/v1/foods/search/progressive?**', (intercepted) =>
            online ? intercepted.fallback() : intercepted.abort('internetdisconnected'),
        );
        await openRecipeEditor(page, RECIPE_ID);

        online = false;
        await context.setOffline(true);
        const field = page.getByRole('combobox', { name: 'Ingredient 1 name' });

        await field.fill('paprika powder');
        await field.press('ArrowDown');
        const list = page.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });

        await expect(
            page.getByText('Waiting for a connection. This loads on its own.', { exact: true }).first(),
        ).toBeVisible();
        await expect(
            list.getByRole('option', { name: 'Use “paprika powder” as written, without nutrition' }),
        ).toBeVisible();

        online = true;
        await context.setOffline(false);

        await expect(list.getByRole('group', { name: 'Food catalog' })).toBeVisible();
    });
});
