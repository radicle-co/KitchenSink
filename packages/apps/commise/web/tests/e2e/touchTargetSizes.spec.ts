import { expect, test, type Locator, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { applyTextScale } from './utils/textScale';

/**
 * A touch target is sized in CSS px, not rem (designer D64, issue #287). A target that holds only a glyph is 44 px
 * square at every text size. A target that holds text is at least 44 px each way and may grow with its text. The
 * measurements come from a real browser, because jsdom lays nothing out. The text size is set by `applyTextScale`,
 * which scales the root font and so grows every rem-sized box with it.
 *
 * Grouped by the screen that hosts the target: the recipe page.
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

async function openRecipe(page: Page): Promise<void> {
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
            }),
        ],
    });
    await page.route(`${PHOTO_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: '' }),
    );
    await page.goto(route(`/recipes/${RECIPE_ID}`));
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
                const stepTwelve = page.getByRole('button', { name: 'Mark step 12 as current' });

                await expectAtLeast('the step 12 number', stepTwelve);

                const { width, height } = await size(stepTwelve);

                expect(Math.abs(width - height), 'the step number stays a circle').toBeLessThanOrEqual(0.5);
            });
        });
    }
}
