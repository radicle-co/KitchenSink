import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, makeRecipeVersion, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { applyTextScale } from './utils/textScale';

/**
 * A touch target is sized in CSS px, not rem (designer D64, issue #287). A target that holds only a glyph is 44 px
 * square at every text size. A target that holds text is at least 44 px each way and may grow with its text. The
 * measurements come from a real browser, because jsdom lays nothing out. The text size is set by `applyTextScale`,
 * which scales the root font and so grows every rem-sized box with it.
 *
 * Grouped by the screen that hosts the target: the recipe page, the editor, Discover and the version history. A step
 * toggle is a circle, at least 44 px, and exactly 44 px at 100% text.
 */

const RECIPE_ID = 'db000000-0000-4000-8000-0000000000f2';
const PHOTO_ORIGIN = 'https://photos.e2e.example.com';

const PHOTOS = [0, 1].map((index) => ({
    id: `pho_touch_${String(index)}`,
    recipeId: RECIPE_ID,
    key: `recipes/${RECIPE_ID}/p${String(index)}.png`,
    url: `${PHOTO_ORIGIN}/p${String(index)}.png`,
    contentType: 'image/png',
    order: index + 1,
    createdAt: '2026-05-02T09:00:00.000Z',
}));

// Twelve steps, so the step numbers include a two-digit one.
const STEPS = Array.from({ length: 12 }, (_, index) => ({
    stepNumber: index + 1,
    instruction: `Stir the pot slowly for a while and keep tasting it as it cooks down, step ${String(index + 1)}.`,
}));

async function openRecipe(
    page: Page,
    suffix = '',
    ingredients?: NonNullable<Parameters<typeof makeRecipeDetail>[0]>['ingredients'],
): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Touch Target Soup',
                photos: PHOTOS,
                steps: STEPS,
                ...(ingredients === undefined ? {} : { ingredients }),
            }),
        ],
    });
    await page.route(`${PHOTO_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: '' }),
    );
    await page.goto(route(`/recipes/${RECIPE_ID}${suffix}`));
}

async function size(target: Locator): Promise<{ width: number; height: number }> {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();

    expect(box).not.toBeNull();

    return { width: box?.width ?? 0, height: box?.height ?? 0 };
}

async function expectFixed(where: string, target: Locator): Promise<void> {
    const { width, height } = await size(target);

    expect(width, `${where}: 44 px wide`).toBeCloseTo(44, 0);
    expect(height, `${where}: 44 px tall`).toBeCloseTo(44, 0);
}

async function expectAtLeast(where: string, target: Locator): Promise<void> {
    const { width, height } = await size(target);

    expect(width, `${where}: at least 44 px wide`).toBeGreaterThanOrEqual(43.5);
    expect(height, `${where}: at least 44 px tall`).toBeGreaterThanOrEqual(43.5);
}

for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
]) {
    for (const textScale of [1, 2]) {
        test.describe(`touch targets on the recipe page at ${String(viewport.width)} px and ${String(textScale * 100)}% text`, () => {
            test.use({ viewport });

            test('a glyph-only target is 44 px and a text target is at least 44 px', async ({ page }) => {
                await openRecipe(page);
                await applyTextScale(page, textScale);

                await expectFixed(
                    'the photo dot',
                    page.getByRole('link', { name: /^Go to Touch Target Soup photo 2$/u }),
                );
                await expectFixed('the more-actions trigger', page.getByRole('button', { name: /^More actions for / }));

                const stepTwelve = page.getByRole('button', { name: 'Mark step 12 as current' });

                // The toggle holds a number, so it is a circle with a 44 px floor. At the largest text its numeral disc
                // (2rem plus padding) outgrows 44, which D65 wants.
                await expectAtLeast('the step 12 number', stepTwelve);

                const box = await size(stepTwelve);

                expect(Math.abs(box.width - box.height), 'the step number stays a circle').toBeLessThanOrEqual(0.5);

                if (textScale === 1) {
                    await expectFixed('the step 12 number at 100% text', stepTwelve);
                } else {
                    // The button grows with its numeral disc and no larger: a fixed rem square would be wider than it.
                    const discWidth = await stepTwelve.evaluate(
                        (button) => button.firstElementChild?.getBoundingClientRect().width ?? 0,
                    );

                    expect(box.width, 'the step toggle is as wide as its numeral').toBeCloseTo(discWidth, 0);
                }

                expect(
                    await stepTwelve.evaluate((button) => {
                        const numeral = button.firstElementChild;

                        return numeral !== null && numeral.scrollWidth > numeral.clientWidth + 0.5;
                    }),
                    'the step number is clipped',
                ).toBe(false);

                await page.getByRole('button', { name: /^Open Touch Target Soup photo 1 full screen$/u }).click();
                await expectFixed('the lightbox close', page.getByRole('button', { name: 'Close photo' }));
            });
        });

        test.describe(`touch targets on the editor at ${String(viewport.width)} px and ${String(textScale * 100)}% text`, () => {
            test.use({ viewport });

            test('the close control and the ingredient panel close are 44 px', async ({ page }) => {
                await openRecipe(page, '/edit', [
                    {
                        ingredientId: 'ing_kale',
                        name: 'Kale',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'bunch',
                        isUserEntered: false,
                        resolutionStatus: 'NOT_FOUND',
                        unresolvedReason: 'no_source_has_it',
                    },
                ]);
                await applyTextScale(page, textScale);

                await expectFixed('the editor close', page.getByRole('button', { name: 'Close editor' }));
                await page.getByRole('button', { name: 'No match found: Kale' }).click();
                await expectFixed('the panel close', page.getByRole('button', { name: 'Close details for Kale' }));
            });
        });

        test.describe(`touch targets on Discover at ${String(viewport.width)} px and ${String(textScale * 100)}% text`, () => {
            test.use({ viewport });

            test('the search clear control and the save control are 44 px', async ({ page }) => {
                await signInWithTicket(page);
                const viewerId = await readViewerAppId(page);

                await mockRecipeApi(page, {
                    viewerId,
                    recipes: [
                        makeRecipeDetail({
                            id: RECIPE_ID,
                            ownerId: 'usr_other',
                            title: 'Touch Target Soup',
                            visibility: 'public',
                        }),
                    ],
                });
                await page.goto(route('/discover'));
                await applyTextScale(page, textScale);
                await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
                await expectFixed(
                    'the save control',
                    page.getByRole('button', { name: 'Save a copy of Touch Target Soup' }).first(),
                );

                await page.getByRole('searchbox', { name: 'Search recipes' }).fill('zzzzzz');
                await expectFixed('the search clear', page.getByRole('button', { name: 'Clear search' }).first());
            });
        });

        test.describe(`touch targets on the version history at ${String(viewport.width)} px and ${String(textScale * 100)}% text`, () => {
            test.use({ viewport });

            test('the compare panel close is 44 px', async ({ page }) => {
                await signInWithTicket(page);
                const viewerId = await readViewerAppId(page);
                const snapshot = (version: number): RecipeSnapshot => ({
                    version,
                    title: `Touch Target Soup v${String(version)}`,
                    description: 'A soup.',
                    steps: [{ id: 'step_1', recipeId: RECIPE_ID, stepNumber: 1, instruction: 'Stir.' }],
                    ingredients: [],
                    servings: 4,
                    prepTimeMinutes: 10,
                    cookTimeMinutes: 20,
                });

                await mockRecipeApi(page, {
                    viewerId,
                    recipes: [
                        makeRecipeDetail({
                            id: RECIPE_ID,
                            ownerId: viewerId,
                            title: 'Touch Target Soup',
                            currentVersion: 2,
                        }),
                    ],
                    recipeVersions: {
                        [RECIPE_ID]: [
                            makeRecipeVersion({
                                id: 'ver_1',
                                recipeId: RECIPE_ID,
                                versionNumber: 1,
                                snapshot: snapshot(1),
                            }),
                            makeRecipeVersion({
                                id: 'ver_2',
                                recipeId: RECIPE_ID,
                                versionNumber: 2,
                                snapshot: snapshot(2),
                            }),
                        ],
                    },
                });
                await page.goto(route(`/recipes/${RECIPE_ID}/versions`));
                await applyTextScale(page, textScale);
                await page.getByRole('button', { name: 'More actions for version 1' }).click();
                await page.getByRole('menuitem', { name: 'Compare with current' }).click();

                await expectFixed('the compare close', page.getByRole('button', { name: 'Close compare' }));
            });
        });
    }
}
