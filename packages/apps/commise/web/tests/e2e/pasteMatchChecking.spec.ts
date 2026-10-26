import { expect, test } from '@playwright/test';

import { mockCandidate, mockRecipeApi, readViewerAppId, type MockFoodMatch } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { openNewRecipe } from './utils/recipeEditor';
import { pasteList, recordRequests } from './utils/pasteList';

/**
 * A pasted line that is still being CHECKED when it joins (ADR-0071 section 9; owner rulings 2026-10-25): it shows the
 * food under review with a Checking tag, Use this and Search; when the review confirms it and nobody chose, it binds to
 * that food by itself; and ⛔ a late verdict NEVER replaces a pick the cook made — the pick stays, with one quiet sentence
 * and a See why. The review's result arrives on the job's own poll (the settling cadence, 20 s), so these waits are long
 * on purpose: they wait on the poll, never on a timeout.
 */
const SCHEMES = ['light', 'dark'] as const;

/** The review finishes on the job's settling poll (`PARSE_JOB_SETTLING_POLL_INTERVAL_MS` is 20 s). */
const REVIEW_TIMEOUT_MS = 50_000;

const WHOLE = mockCandidate('food_whole', 'Whole milk');
const OAT = mockCandidate('food_oat', 'Oat milk');

const checkingThenConfident: Readonly<Record<string, MockFoodMatch>> = {
    milk: {
        first: { state: 'checking', reason: 'awaitingReview', proposed: OAT, candidates: [OAT, WHOLE] },
        then: { state: 'confident', reason: 'reviewVerified', proposed: WHOLE, candidates: [WHOLE, OAT] },
    },
};

for (const colorScheme of SCHEMES) {
    test.describe(`Paste a list, a line still being checked (${colorScheme})`, () => {
        test.use({ colorScheme });
        test.setTimeout(120_000);

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
            await page.setViewportSize({ width: 390, height: 844 });
        });

        test('a checking line shows the food under review, and binds to it when the review confirms and nobody chose', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: { matches: checkingThenConfident },
            });
            const sent = recordRequests(page);
            await openNewRecipe(page);
            const ingredients = await pasteList(page, '2 cups milk');

            await expect(ingredients.getByText('Checking')).toBeVisible({ timeout: 20_000 });
            await expect(ingredients.getByRole('button', { name: /^Use this: Oat milk/u })).toBeVisible();
            await expect(ingredients.getByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeVisible();
            expect(sent.bodiesOf('/api/v1/ingredients/by-food')).toEqual([]);

            // ⛔ THE REVIEW, not a click: the poll brings the verdict, and the line binds to the food it confirmed.
            await expect(ingredients.getByText('Whole milk')).toBeVisible({ timeout: REVIEW_TIMEOUT_MS });
            await expect(ingredients.getByText(/your choice/u)).toHaveCount(0);
            expect(sent.bodiesOf('/api/v1/ingredients/by-food')).toEqual([{ foodId: 'food_whole' }]);
        });

        test('⛔ a late verdict never replaces the cook’s pick: it stays, with a quiet sentence and See why', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: { matches: checkingThenConfident },
            });
            const sent = recordRequests(page);
            await openNewRecipe(page);
            const ingredients = await pasteList(page, '2 cups milk');

            await ingredients.getByRole('button', { name: /^Use this: Oat milk/u }).click({ timeout: 20_000 });
            await expect(ingredients.getByText(/Oat milk\s+· your choice/u)).toBeVisible();

            await expect(ingredients.getByText('Our check suggested Whole milk. Your choice stays.')).toBeVisible({
                timeout: REVIEW_TIMEOUT_MS,
            });
            await expect(ingredients.getByText(/Oat milk\s+· your choice/u)).toBeVisible();
            await ingredients.getByRole('button', { name: /^See why our check suggested Whole milk/u }).click();
            await expect(
                ingredients.getByText('Our check read the line and agreed that this is the food.'),
            ).toBeVisible();
            // The pick is the only food that was ever admitted: the verdict bound nothing.
            expect(sent.bodiesOf('/api/v1/ingredients/by-food')).toEqual([{ foodId: 'food_oat' }]);
        });
    });
}
