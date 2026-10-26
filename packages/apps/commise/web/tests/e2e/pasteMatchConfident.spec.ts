import { expect, test } from '@playwright/test';

import { mockCandidate, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { editorSection, openNewRecipe } from './utils/recipeEditor';
import { pasteList, recordRequests } from './utils/pasteList';

/**
 * A pasted list whose lines the service matches CONFIDENTLY (ADR-0071; owner rulings 2026-10-25): they arrive bound to
 * the food the match names, through the real browser, in both themes (D15), with the recipe-service contract
 * intercepted. What only this tier proves: the lines are matched by one `POST /matches` after the parse settles, each is
 * bound by FOOD (`by-food`) and never looked up by name, a line is drawn ONCE (as the matched list, not again as an
 * ordinary row), and the recipe's create carries what each line was read from.
 *
 * Selectors are role and label only; every wait is on a settled state, never a timeout.
 */
const SCHEMES = ['light', 'dark'] as const;

/** Bound for an assertion that must outlast a poll or two (`DEFAULT_PARSE_JOB_POLL_INTERVAL_MS` is 4 s). */
const POLL_SETTLE_TIMEOUT_MS = 20_000;

const WHOLE = mockCandidate('food_whole', 'Whole milk');
const EGG = mockCandidate('food_egg', 'Egg, whole, raw');

for (const colorScheme of SCHEMES) {
    test.describe(`Paste a list, confident matches (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
        });

        test('⛔ confident lines bind by food, never by name, and each line is drawn once', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: {
                    matches: {
                        milk: {
                            first: { state: 'confident', reason: 'exactName', proposed: WHOLE, candidates: [WHOLE] },
                        },
                        eggs: {
                            first: { state: 'confident', reason: 'curatedMapping', proposed: EGG, candidates: [EGG] },
                        },
                    },
                },
            });
            const sent = recordRequests(page);
            await openNewRecipe(page);

            const ingredients = await pasteList(page, '2 cups milk\n3 eggs');

            // ⛔ THE POLL AND THE MATCH, not a click: the lines arrive matched and bound.
            await expect(ingredients.getByText('Whole milk')).toBeVisible({ timeout: POLL_SETTLE_TIMEOUT_MS });
            await expect(ingredients.getByText('Egg, whole, raw')).toBeVisible();
            await expect(ingredients.getByRole('button', { name: 'Change the food for 2 cups milk' })).toBeVisible();
            await expect(ingredients.getByRole('button', { name: 'Change the food for 3 eggs' })).toBeVisible();
            await expect(ingredients.getByText('Added 2 lines')).toBeVisible();
            await expect(ingredients.getByText(/2 matched/u)).toBeVisible();

            // No line twice: the ordinary list is not drawn for lines the matched list owns.
            await expect(ingredients.getByRole('list', { name: 'Ingredients' })).toHaveCount(0);
            await expect(ingredients.getByText('Whole milk')).toHaveCount(1);

            expect(sent.routes().filter((route) => route.includes('/matches'))).toEqual([
                expect.stringContaining('POST'),
            ]);
            expect(sent.routes()).not.toContain('POST /api/v1/ingredients/by-name');
            expect(sent.bodiesOf('/api/v1/ingredients/by-food')).toEqual([
                { foodId: 'food_whole' },
                { foodId: 'food_egg' },
            ]);
        });

        test('the recipe’s create carries what each matched line was read from', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: {
                    matches: {
                        milk: {
                            first: { state: 'confident', reason: 'exactName', proposed: WHOLE, candidates: [WHOLE] },
                        },
                    },
                },
            });
            await openNewRecipe(page);
            const ingredients = await pasteList(page, '2 cups milk');

            await expect(ingredients.getByText('Whole milk')).toBeVisible({ timeout: POLL_SETTLE_TIMEOUT_MS });

            const created = page.waitForRequest(
                (request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api/v1/recipes'),
            );
            await page.getByLabel('Title').fill('Pasted Pancakes');
            await page
                .getByRole('navigation', { name: 'Recipe sections' })
                .getByRole('link', { name: 'Steps' })
                .click();
            const body = (await created).postDataJSON() as {
                readonly ingredients: readonly { readonly sourceLine?: string; readonly sourcePhrase?: string }[];
            };

            expect(body.ingredients.map((line) => [line.sourceLine, line.sourcePhrase])).toEqual([
                ['2 cups milk', 'milk'],
            ]);
            await expect(editorSection(page, 'Ingredients').getByText('Whole milk')).toHaveCount(1);
        });
    });
}
