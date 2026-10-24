import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The recipe detail discloses STALE nutrition, end to end through the real web UI (KTD-3b — serve stale, MARKED).
 *
 * The detail response carries `nutrition.freshness`; `stale` means some figures came from the recipe service's
 * saved copy of food data rather than a fetch for this read. The component tests prove the sentence renders for
 * a `stale` prop. What only this tier proves is the wire: that a real detail RESPONSE carrying the marker is
 * parsed by the client (the schema is non-strict, so a client without the field in its zod would silently
 * STRIP it and render nothing), reaches the page through the real data layer, and lands inside the nutrition
 * region a reader navigates to.
 *
 * ⛔ SELECTORS: role and text only (repo policy — `data-testid` and `waitForTimeout` are banned). The notice is
 * plain prose, so it is reached by its text inside the named `region`.
 */

/** The localized disclosure, verbatim — a paraphrase in the UI must fail this spec. */
const STALE_NOTICE = 'These figures include saved food data, so they may be out of date.';

/** The nutrition section's accessible name. */
const NUTRITION_REGION = 'Nutrition (per serving)';

test.describe('recipe-detail nutrition freshness', () => {
    test('a detail whose nutrition was served from saved food data SAYS so, inside the nutrition region', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000032',
                    ownerId: viewerId,
                    title: 'Saved-Data Stew',
                    nutrition: {
                        calories: 480,
                        proteinG: 22,
                        carbsG: 30,
                        fatG: 18,
                        isComplete: true,
                        freshness: 'stale',
                    },
                }),
            ],
        });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000032'));
        await expect(page.getByRole('heading', { level: 1, name: 'Saved-Data Stew' })).toBeVisible();

        const nutrition = page.getByRole('region', { name: NUTRITION_REGION });
        await expect(nutrition.getByText('480', { exact: true })).toBeVisible();
        await expect(nutrition.getByText(STALE_NOTICE, { exact: true })).toBeVisible();
    });

    test('a detail whose nutrition was fetched for this read shows NO freshness sentence', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-00000000000d',
                    ownerId: viewerId,
                    title: 'Fresh-Data Stew',
                }),
            ],
        });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-00000000000d'));
        await expect(page.getByRole('heading', { level: 1, name: 'Fresh-Data Stew' })).toBeVisible();

        const nutrition = page.getByRole('region', { name: NUTRITION_REGION });
        await expect(nutrition.getByText('420', { exact: true })).toBeVisible();
        await expect(page.getByText(STALE_NOTICE)).toHaveCount(0);
    });
});

/**
 * A-015 / D2 / D11 (`buildSpec.md` §6.7 "Nutrition unavailable"): a recipe with no ingredients shows a dash in each cell and one
 * line, never four zeros; and the figures a reader sees are whole, grouped numbers.
 */
test.describe('recipe-detail nutrition states', () => {
    test('a title-only draft shows four dashes and one line — never zeros', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000033',
                    ownerId: viewerId,
                    title: 'Title-Only Draft',
                    ingredients: [],
                    steps: [],
                    nutrition: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: true, freshness: 'fresh' },
                }),
            ],
        });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000033'));
        await expect(page.getByRole('heading', { level: 1, name: 'Title-Only Draft' })).toBeVisible();

        const nutrition = page.getByRole('region', { name: NUTRITION_REGION });
        await expect(nutrition.getByText('—', { exact: true })).toHaveCount(4);
        await expect(nutrition.getByText('0', { exact: true })).toHaveCount(0);
        await expect(nutrition.getByText('Not counted yet: no ingredient has a food.')).toHaveCount(1);
    });

    test('groups and rounds the figures for the reader', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000034',
                    ownerId: viewerId,
                    title: 'Big Number Stew',
                    nutrition: {
                        calories: 1290.7,
                        proteinG: 12.4,
                        carbsG: 1287,
                        fatG: 0.4,
                        isComplete: true,
                        freshness: 'fresh',
                    },
                }),
            ],
        });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000034'));

        const nutrition = page.getByRole('region', { name: NUTRITION_REGION });
        await expect(nutrition.getByText('1,291', { exact: true })).toBeVisible();
        await expect(nutrition.getByText('1,287 g', { exact: true })).toBeVisible();
        await expect(nutrition.getByText('12 g', { exact: true })).toBeVisible();
    });
});
