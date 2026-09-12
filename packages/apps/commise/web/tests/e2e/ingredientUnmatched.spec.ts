import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Plan 002 US1, through the real web app with the recipe-service contract intercepted: in the recipe editor an
 * ingredient that did not match shows its status word and an alert glyph in the row; activating the glyph explains
 * THIS row's cause in plain words, and Escape returns focus to the glyph (`ingredientStatusExplanation.md` SPECIFY.1,
 * §3 2.1.1/2.4.3, §6d — activation only, no hover).
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
                id: 'rec_unmatched',
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

    await page.goto(route('/recipes/rec_unmatched/edit'));
    await page.getByRole('button', { name: /Ingredients:/ }).click();
    await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 2 of 4');
};

const runUnmatchedStory = async (page: Page): Promise<void> => {
    const ingredients = page.getByRole('region', { name: 'Ingredients' });

    // The status words come from the row policy; a matched row is not news and has none. Each word describes its
    // row's glyph, so it is asserted as what a screen reader hears there.
    await expect(ingredients.getByRole('button', { name: 'About Kale' })).toHaveAccessibleDescription('No match found');
    await expect(ingredients.getByRole('button', { name: 'About Saffron' })).toHaveAccessibleDescription(
        'Resolution failed',
    );
    await expect(ingredients.getByRole('button', { name: 'About Arborio rice' })).toHaveAccessibleDescription('');

    // Activation opens THIS row's explanation…
    const aboutKale = ingredients.getByRole('button', { name: 'About Kale' });
    await expect(aboutKale).toHaveAttribute('aria-expanded', 'false');
    await aboutKale.click();
    const kale = page.getByRole('dialog', { name: 'Kale' });
    await expect(kale).toContainText('We searched the food database and there’s no match for this.');
    await expect(aboutKale).toHaveAttribute('aria-expanded', 'true');

    // …and Escape closes it and returns focus to the glyph (APG).
    await page.keyboard.press('Escape');
    await expect(kale).toHaveCount(0);
    await expect(aboutKale).toBeFocused();

    // The keyboard alone reaches the next row's cause, and it is a DIFFERENT cause.
    const aboutSaffron = ingredients.getByRole('button', { name: 'About Saffron' });
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
    test('desktop: the glyph opens the row’s own cause; Escape and Close return focus', async ({ page }) => {
        await seedEditor(page);
        await runUnmatchedStory(page);
    });

    test('Try again on a FAILED row reads that binding\u2019s status, and the row changes in place', async ({
        page,
    }) => {
        // Food answers this time: the open failure settles to a definite "no match".
        await seedEditor(page, { ing_saffron: 'NOT_FOUND' });
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        const aboutSaffron = ingredients.getByRole('button', { name: 'About Saffron' });
        await aboutSaffron.click();

        const statusRead = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/ingredients/ing_saffron/status') && request.method() === 'GET',
        );
        await page.getByRole('dialog', { name: 'Saffron' }).getByRole('button', { name: 'Try again' }).click();
        await statusRead;

        await expect(aboutSaffron).toHaveAccessibleDescription('No match found');
        await expect(ingredients.getByRole('button', { name: 'About Kale' })).toHaveAccessibleDescription(
            'No match found',
        );
        // The focus target after Try again is the row's status glyph (recorded for UX sign-off).
        await expect(aboutSaffron).toBeFocused();
    });

    test.describe('at 320 × 640 (WCAG 1.4.10 reflow)', () => {
        test.use({ viewport: { width: 320, height: 640 } });

        test('the same story, and neither the row nor the open panel scrolls the page sideways', async ({ page }) => {
            await seedEditor(page);
            await runUnmatchedStory(page);

            await page.getByRole('region', { name: 'Ingredients' }).getByRole('button', { name: 'About Kale' }).click();
            await expect(page.getByRole('dialog', { name: 'Kale' })).toBeVisible();
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBeLessThanOrEqual(0);
        });
    });
});
