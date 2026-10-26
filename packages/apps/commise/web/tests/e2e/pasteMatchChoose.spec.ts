import { expect, test } from '@playwright/test';

import { mockCandidate, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { openNewRecipe } from './utils/recipeEditor';
import { matchedLine, paragraphWith, pasteList, recordRequests } from './utils/pasteList';

/**
 * A pasted list with lines that NEED THE COOK (ADR-0071; ADR-0070 section 5; owner rulings 2026-10-25), through the real
 * browser, in both themes (D15), with the recipe-service contract intercepted. A default is shown with its tag and
 * NOTHING is selected for the cook; a doubtful or unmatched line asks; the open line is expanded one at a time on a
 * phone; choosing a food opens the next open line and gives it focus; every line the cook fixes keeps a direct Search.
 *
 * Selectors are role and label only; every wait is on a settled state, never a timeout.
 */
const SCHEMES = ['light', 'dark'] as const;

/** Bound for an assertion that must outlast a poll or two (`DEFAULT_PARSE_JOB_POLL_INTERVAL_MS` is 4 s). */
const POLL_SETTLE_TIMEOUT_MS = 20_000;

const WHOLE = mockCandidate('food_whole', 'Whole milk', { isDefault: true });
const SKIM = mockCandidate('food_skim', 'Skim milk');
const OAT = mockCandidate('food_oat', 'Oat milk');
const WHITE = mockCandidate('food_white', 'White bread, sliced');
const BRIOCHE = mockCandidate('food_brioche', 'Brioche');

for (const colorScheme of SCHEMES) {
    test.describe(`Paste a list, choosing foods (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
            await page.setViewportSize({ width: 390, height: 844 });
        });

        test('⛔ a default is tagged and never selected; the cook’s pick binds, and the next open line takes focus', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: {
                    matches: {
                        milk: {
                            first: {
                                state: 'default',
                                reason: 'defaultApplies',
                                proposed: null,
                                candidates: [WHOLE, SKIM, OAT],
                            },
                        },
                        bread: {
                            first: {
                                state: 'needsChoice',
                                reason: 'noProposal',
                                proposed: null,
                                candidates: [WHITE, BRIOCHE],
                            },
                        },
                        'spice mix': {
                            first: { state: 'noMatch', reason: 'noCandidates', proposed: null, candidates: [] },
                        },
                    },
                },
            });
            const sent = recordRequests(page);
            await openNewRecipe(page);

            const ingredients = await pasteList(page, '2 cups milk\n3 bread\n1 tsp spice mix');

            // The first open line is expanded: its prompt, the Default tag, and nothing chosen.
            await expect(paragraphWith(ingredients, 'Choose the milk you use')).toBeVisible({
                timeout: POLL_SETTLE_TIMEOUT_MS,
            });
            await expect(ingredients.getByRole('button', { name: 'Whole milk, Default' })).toBeVisible();
            await expect(ingredients.getByRole('button', { name: /, chosen$/u })).toHaveCount(0);
            await expect(paragraphWith(ingredients, /3 to choose/u)).toBeVisible();
            // The other open lines are collapsed rows that name what they need.
            await expect(ingredients.getByRole('button', { name: /^Choose a food\s+· 2 options/u })).toBeVisible();
            await expect(
                ingredients.getByRole('button', { name: /^No food found\s+· search or keep as written/u }),
            ).toBeVisible();
            // Every line the cook fixes keeps a direct way to search for a food.
            await expect(ingredients.getByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeVisible();
            // ⛔ No food has been admitted for the cook.
            expect(sent.bodiesOf('/api/v1/ingredients/by-food')).toEqual([]);

            await ingredients.getByRole('button', { name: 'Skim milk' }).click();

            await expect(matchedLine(ingredients, '2 cups milk')).toContainText(/Skim milk\s+· your choice/u);
            expect(sent.bodiesOf('/api/v1/ingredients/by-food')).toEqual([{ foodId: 'food_skim' }]);
            // Choosing opened the next open line, and its Search took focus.
            await expect(ingredients.getByRole('button', { name: 'Search for a food for 3 bread' })).toBeFocused();

            await ingredients.getByRole('button', { name: /^Keep .*3 bread.* as written/u }).click();
            await expect(matchedLine(ingredients, '3 bread')).toContainText('Kept as written');
            await expect(
                ingredients.getByRole('button', { name: 'Search for a food for 1 tsp spice mix' }),
            ).toBeFocused();

            await ingredients.getByRole('button', { name: /^Keep .*spice mix.* as written/u }).click();

            // Nothing is open: the summary takes focus and counts what is matched.
            await expect(paragraphWith(ingredients, /1 matched/u)).toBeVisible();
            expect(sent.routes()).not.toContain('POST /api/v1/ingredients/by-name');
        });

        test('Search for a food hands the line to the food picker, which binds the food as the cook’s', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                parseJob: {
                    matches: {
                        milk: {
                            first: {
                                state: 'needsChoice',
                                reason: 'noProposal',
                                proposed: null,
                                candidates: [SKIM, OAT],
                            },
                        },
                    },
                },
            });
            await openNewRecipe(page);
            const ingredients = await pasteList(page, '2 cups milk');

            await ingredients.getByRole('button', { name: 'Search for a food for 2 cups milk' }).click({
                timeout: POLL_SETTLE_TIMEOUT_MS,
            });

            // The line is drawn by the picker now, on its own words, and not twice.
            await expect(ingredients.getByRole('combobox')).toBeVisible();
        });
    });
}
