import { expect, test } from '@playwright/test';

import { mockCandidate, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { addStep, chooseCuisine, openNewRecipe } from './utils/recipeEditor';
import { paragraphWith, pasteList } from './utils/pasteList';

/**
 * Publishing with lines that have no food yet is ALLOWED, but the cook is asked first (R23; `ingredientMatching.md`,
 * "Save"), through the real browser, in both themes (D15). The sheet names the lines, says they are saved as written
 * and do not count toward nutrition, and offers Choose now or Publish anyway. Choose now opens the first open line and
 * publishes nothing; Publish anyway publishes.
 */
const SCHEMES = ['light', 'dark'] as const;

/** Bound for an assertion that must outlast a poll or two (`DEFAULT_PARSE_JOB_POLL_INTERVAL_MS` is 4 s). */
const POLL_SETTLE_TIMEOUT_MS = 20_000;

const WHOLE = mockCandidate('food_whole', 'Whole milk', { isDefault: true });
const SKIM = mockCandidate('food_skim', 'Skim milk');
const WHITE = mockCandidate('food_white', 'White bread, sliced');
const BRIOCHE = mockCandidate('food_brioche', 'Brioche');

for (const colorScheme of SCHEMES) {
    test.describe(`Paste a list, publishing with open choices (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
            await page.setViewportSize({ width: 390, height: 844 });
        });

        test('⛔ Publish asks first; Choose now opens the first open line and publishes nothing; Publish anyway publishes', async ({
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
                                candidates: [WHOLE, SKIM],
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
                    },
                },
            });
            await openNewRecipe(page);
            await page.getByLabel('Title').fill('Bread Pudding');
            await chooseCuisine(page);
            await addStep(page, 'Soak the bread.');
            const ingredients = await pasteList(page, '2 cups milk\n3 bread');
            await expect(paragraphWith(ingredients, 'Choose the milk you use')).toBeVisible({
                timeout: POLL_SETTLE_TIMEOUT_MS,
            });

            const writes: string[] = [];

            page.on('request', (request) => {
                const url = new URL(request.url());

                if (request.method() !== 'GET' && url.pathname.endsWith('/api/v1/recipes')) {
                    writes.push(JSON.stringify(request.postDataJSON()));
                }
            });

            await page.getByRole('button', { name: 'Publish', exact: true }).click();

            const sheet = page.getByRole('dialog', { name: '2 ingredients have no food yet' });

            await expect(sheet).toBeVisible();
            // Names the open lines as the locale writes a list (`openChoicesCopy.test.ts`). The second line is named as
            // the stubbed parse drew it ("3 bread", its count kept), so the spec pins both names and not the wording
            // of the stub's parse.
            await expect(paragraphWith(sheet, /milk and .*bread/u)).toBeVisible();
            expect(writes.filter((body) => body.includes('"status":"published"'))).toEqual([]);

            await sheet.getByRole('button', { name: 'Choose now' }).click();
            await expect(sheet).toHaveCount(0);
            await expect(ingredients.getByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeFocused();
            expect(writes.filter((body) => body.includes('"status":"published"'))).toEqual([]);

            await page.getByRole('button', { name: 'Publish', exact: true }).click();
            const publishWrite = page.waitForRequest(
                (request) =>
                    request.method() !== 'GET' &&
                    new URL(request.url()).pathname.includes('/api/v1/recipes') &&
                    (request.postData() ?? '').includes('"status":"published"'),
            );
            await page
                .getByRole('dialog', { name: '2 ingredients have no food yet' })
                .getByRole('button', { name: 'Publish anyway' })
                .click();

            await publishWrite;
        });
    });
}
