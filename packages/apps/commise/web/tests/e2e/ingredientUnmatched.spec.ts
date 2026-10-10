import { expect, test, type Page } from '@playwright/test';

import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * Plan 002 US1, through the real web app with the recipe-service contract intercepted: in the recipe editor an
 * ingredient that did not match says so in an attention line under its name, and a matched row is quiet (build spec
 * §7.5.1, REWRITTEN for the read rows: the glyph on every row is gone). Activating the attention line explains THIS
 * row's cause in plain words, and Escape returns focus to it (`ingredientStatusExplanation.md` SPECIFY.1, §3
 * 2.1.1/2.4.3, §6d — activation only, no hover).
 *
 * What only this tier proves: the Radix popover's portal, focus return and collision handling in a real engine, and
 * that the editor's seed carries each line's status through to the row.
 *
 * ⚠️ US1's "offers something I can act on" is PARTIAL here: the remedies (Change food, Create my own food, the
 * candidate list, Try again) are plan 002 V1 steps B4-B7 and are not built yet, so this spec asserts the explanation
 * and not a remedy. Selectors are role/label/text only.
 */
const seedEditor = async (page: Page, ingredientStatuses: Readonly<Record<string, string>> = {}): Promise<void> => {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        ingredientStatuses,
        recipes: [
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-000000000035',
                ownerId: viewerId,
                title: 'Green Risotto',
                currentVersion: 3,
                ingredients: [
                    {
                        ingredientId: 'ing_rice',
                        name: 'Arborio rice',
                        quantity: { kind: 'exact', value: 300 },
                        unit: 'g',
                        isUserEntered: false,
                        resolutionStatus: 'RESOLVED',
                    },
                    {
                        ingredientId: 'ing_kale',
                        name: 'Kale',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'bunch',
                        isUserEntered: false,
                        resolutionStatus: 'NOT_FOUND',
                        unresolvedReason: 'no_source_has_it',
                    },
                    {
                        ingredientId: 'ing_saffron',
                        name: 'Saffron',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'pinch',
                        isUserEntered: false,
                        resolutionStatus: 'FAILED',
                        unresolvedReason: 'sources_errored',
                    },
                ],
            }),
        ],
    });

    await openRecipeEditor(page, 'ec000000-0000-4000-8000-000000000035');
};

const runUnmatchedStory = async (page: Page): Promise<void> => {
    const ingredients = page.getByRole('region', { name: 'Ingredients' });

    // Each row that needs the cook says why, in a line named for its food; a matched row is not news and is quiet.
    await expect(ingredients.getByRole('button', { name: 'No match found: Kale' })).toHaveText('No match found');
    await expect(ingredients.getByRole('button', { name: 'Couldn’t look up: Saffron' })).toHaveText('Couldn’t look up');
    await expect(ingredients.getByRole('button', { name: /: Arborio rice$/u })).toHaveCount(0);

    // Activation opens THIS row's explanation…
    const aboutKale = ingredients.getByRole('button', { name: 'No match found: Kale' });
    await expect(aboutKale).toHaveAttribute('aria-expanded', 'false');
    await aboutKale.click();
    const kale = page.getByRole('dialog', { name: 'Kale' });
    await expect(kale).toContainText('We searched the food database and there’s no match for this.');
    await expect(aboutKale).toHaveAttribute('aria-expanded', 'true');

    // …and Escape closes it and returns focus to the line that opened it (APG).
    await page.keyboard.press('Escape');
    await expect(kale).toHaveCount(0);
    await expect(aboutKale).toBeFocused();

    // The keyboard alone reaches the next row's cause, and it is a DIFFERENT cause.
    const aboutSaffron = ingredients.getByRole('button', { name: 'Couldn’t look up: Saffron' });
    await aboutSaffron.focus();
    await page.keyboard.press('Enter');
    const saffron = page.getByRole('dialog', { name: 'Saffron' });
    await expect(saffron).toContainText('We couldn’t reach the food database.');
    await expect(saffron).not.toContainText('no match for this');
    await page.getByRole('button', { name: 'Close details for Saffron' }).click();
    await expect(saffron).toHaveCount(0);
    await expect(aboutSaffron).toBeFocused();
};

test.describe('an unmatched ingredient explains itself in the editor (plan 002 US1)', () => {
    test('desktop: the attention line opens the row’s own cause; Escape and Close return focus', async ({ page }) => {
        await seedEditor(page);
        await runUnmatchedStory(page);
    });

    test('Try again on a FAILED row reads that binding\u2019s status, and the row changes in place', async ({
        page,
    }) => {
        // Food answers this time: the open failure settles to a definite "no match".
        await seedEditor(page, { ing_saffron: 'NOT_FOUND' });
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        await ingredients.getByRole('button', { name: 'Couldn’t look up: Saffron' }).click();

        const statusRead = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/ingredients/ing_saffron/status') && request.method() === 'GET',
        );
        await page.getByRole('dialog', { name: 'Saffron' }).getByRole('button', { name: 'Try again' }).click();
        await statusRead;

        await expect(ingredients.getByRole('button', { name: 'No match found: Saffron' })).toBeVisible();
        await expect(ingredients.getByRole('button', { name: 'No match found: Kale' })).toBeVisible();
        // The attention line gave way while the ask ran, so focus is on the row's open control, never the page.
        await expect(ingredients.getByRole('button', { name: 'Edit 1 pinch Saffron' })).toBeFocused();
    });

    test.describe('at 320 × 640 (WCAG 1.4.10 reflow)', () => {
        test.use({ viewport: { width: 320, height: 640 } });

        test('the same story, and neither the row nor the open panel scrolls the page sideways', async ({ page }) => {
            await seedEditor(page);
            await runUnmatchedStory(page);

            await page
                .getByRole('region', { name: 'Ingredients' })
                .getByRole('button', { name: 'No match found: Kale' })
                .click();
            await expect(page.getByRole('dialog', { name: 'Kale' })).toBeVisible();
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBeLessThanOrEqual(0);
        });
    });
});
