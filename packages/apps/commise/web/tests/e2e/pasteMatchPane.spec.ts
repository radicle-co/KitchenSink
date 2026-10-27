import { expect, test } from '@playwright/test';

import { mockCandidate, mockRecipeApi, readViewerAppId, type MockFoodMatch } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { openNewRecipe } from './utils/recipeEditor';
import { paragraphWith, pasteList } from './utils/pasteList';

/**
 * The side pane at the wide container class (ADR-0071; `ingredientMatching.md`, owner rulings 2026-10-25): from 960 px of
 * content the open line's options stand in a pane beside the list, which says which line it shows out of ALL of them and
 * steps with Previous and Next open line. A pick in the pane does not move on by itself. Below the wide class there is no
 * pane: the open line is expanded in the list instead.
 */
const SCHEMES = ['light', 'dark'] as const;

/** Bound for an assertion that must outlast a poll or two (`DEFAULT_PARSE_JOB_POLL_INTERVAL_MS` is 4 s). */
const POLL_SETTLE_TIMEOUT_MS = 20_000;

const WHOLE = mockCandidate('food_whole', 'Whole milk', { isDefault: true });
const SKIM = mockCandidate('food_skim', 'Skim milk');
const WHITE = mockCandidate('food_white', 'White bread, sliced');
const BRIOCHE = mockCandidate('food_brioche', 'Brioche');

const MATCHES: Readonly<Record<string, MockFoodMatch>> = {
    milk: { first: { state: 'default', reason: 'defaultApplies', proposed: null, candidates: [WHOLE, SKIM] } },
    bread: { first: { state: 'needsChoice', reason: 'noProposal', proposed: null, candidates: [WHITE, BRIOCHE] } },
};

for (const colorScheme of SCHEMES) {
    test.describe(`Paste a list, the side pane (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
        });

        test('⛔ the pane shows the first open line out of all of them, steps on, and a pick does not move it', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', parseJob: { matches: MATCHES } });
            await openNewRecipe(page);
            const ingredients = await pasteList(page, '2 cups milk\n3 bread');
            const pane = ingredients.getByRole('complementary', { name: 'Choose a food' });

            await expect(paragraphWith(pane, 'Line 1 of 2')).toBeVisible({ timeout: POLL_SETTLE_TIMEOUT_MS });
            await expect(pane.getByRole('heading', { name: '2 cups milk' })).toBeVisible();
            await expect(pane.getByRole('button', { name: 'Whole milk, Default' })).toBeVisible();

            await pane.getByRole('button', { name: 'Skim milk' }).click();
            await expect(pane.getByRole('button', { name: 'Skim milk, chosen' })).toBeVisible();
            // A pick in the pane does not move on by itself: Next does.
            await expect(paragraphWith(pane, 'Line 1 of 2')).toBeVisible();

            await pane.getByRole('button', { name: 'Next open line' }).click();
            await expect(paragraphWith(pane, 'Line 2 of 2')).toBeVisible();
            await expect(pane.getByRole('heading', { name: '3 bread' })).toBeVisible();
            // Previous steps to the open line before this one (`paneStepsOf`). Line 1 is chosen now, so nothing is
            // open before line 2 and Previous is refused, drawn and focusable (aria-disabled), never natively disabled.
            await expect(pane.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');
        });

        test('below the wide class there is no pane: the open line is expanded in the list', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', parseJob: { matches: MATCHES } });
            await openNewRecipe(page);
            const ingredients = await pasteList(page, '2 cups milk\n3 bread');

            await expect(paragraphWith(ingredients, 'Choose the milk you use')).toBeVisible({
                timeout: POLL_SETTLE_TIMEOUT_MS,
            });
            await expect(ingredients.getByRole('complementary', { name: 'Choose a food' })).toHaveCount(0);
        });
    });
}
