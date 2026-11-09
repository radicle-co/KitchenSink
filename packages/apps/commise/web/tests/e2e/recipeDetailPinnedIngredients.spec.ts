import { expect, test, type Page } from '@playwright/test';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * Owner ruling R1 (`docs/design/uiRefreshWorkshop5/ownerFeedback.md`) and the phone gutter, on the real recipe page:
 * plan `docs/plans/2026-11-08-pinnedIngredientsBar.md`. Below a 720 px body, once the ingredients card has scrolled
 * away, ONE button pins under the top chrome; it opens the list over the content, with the servings stepper first.
 * From 720 the sticky column does that job and the bar never renders.
 *
 * Every measurement is taken in a real browser, because jsdom lays nothing out.
 */

const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000b1';
const GUTTER = 16;

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);
const PHOTO_ORIGIN = 'https://photos.pinned.e2e.example';

const INGREDIENTS: readonly RecipeIngredientView[] = Array.from({ length: 13 }, (_, index) => ({
    ingredientId: `ec000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    name:
        index === 4
            ? 'extraordinarilylongingredientnamewithnobreakatallanywherehere'
            : `ingredient number ${String(index + 1)}`,
    ...(index < 5 ? { groupLabel: 'For the sauce' } : { groupLabel: 'To finish' }),
    foodId: `food_pinned_${String(index)}`,
    quantity: { kind: 'exact', value: index + 1 } as const,
    unit: 'g',
    isUserEntered: false,
}));

const STEPS = Array.from({ length: 14 }, (_, index) => ({
    stepNumber: index + 1,
    instruction:
        index === 2
            ? 'Step 3: aVeryLongUnbrokenInstructionTokenThatNeverBreaksAnywhereAtAllForRealThisTime'
            : `Step ${String(index + 1)}: keep stirring the pot gently until the sauce has thickened and shines.`,
}));

async function openRecipe(page: Page): Promise<void> {
    await page.route(`${PHOTO_ORIGIN}/**`, (photo) => photo.fulfill({ contentType: 'image/png', body: PNG }));
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Slow Braised Short Ribs With Red Wine, Shallots And Thyme',
                sourceAttribution: 'https://example.com/aVeryLongUnbrokenAttributionTokenThatNeverBreaksAnywhereAtAll',
                servings: 4,
                description:
                    'A long description that runs over several lines so the page has real text to wrap, and a long unbroken token https://example.com/a/very/long/path/that/never/breaks/anywhere/at/all/for/real',
                tags: ['dinner', 'winter', 'make ahead', 'anUnbrokenTagThatIsMuchLongerThanAnyPhoneScreenCouldHold'],
                sourceUrl:
                    'https://example.com/recipes/a/very/long/path/that/never/breaks/anywhere/at/all/for/real/short-ribs',
                coverPhotoUrl: `${PHOTO_ORIGIN}/p0.png`,
                photos: [0, 1, 2].map((index) => ({
                    id: `pho_pinned_${String(index)}`,
                    recipeId: RECIPE_ID,
                    key: `recipes/${RECIPE_ID}/p${String(index)}.png`,
                    url: `${PHOTO_ORIGIN}/p${String(index)}.png`,
                    contentType: 'image/png',
                    order: index + 1,
                    createdAt: '2026-05-02T09:00:00.000Z',
                })),
                ingredients: [...INGREDIENTS],
                steps: STEPS,
            }),
        ],
    });
    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Scroll the Steps heading to the top of the page, so the ingredients card above it is wholly under the chrome. */
async function scrollIntoSteps(page: Page): Promise<void> {
    await page.getByRole('heading', { name: 'Steps' }).evaluate((heading) => {
        heading.scrollIntoView({ block: 'start' });
    });
}

for (const width of [430, 375]) {
    test.describe(`recipe page at ${String(width)} px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('the page does not overflow sideways, and every card keeps the same gap on both sides', async ({
            page,
        }) => {
            await openRecipe(page);

            const gaps = await page.evaluate(() => {
                const client = document.documentElement.clientWidth;

                // A box inside a clipping ancestor (the photo carousel's strip) is meant to run past the edge.
                const clipped = (node: Element): boolean => {
                    for (let up = node.parentElement; up !== null && up.tagName !== 'ARTICLE'; up = up.parentElement) {
                        if (getComputedStyle(up).overflowX !== 'visible') {
                            return true;
                        }
                    }

                    return false;
                };

                return Array.from(document.querySelectorAll('article *'))
                    .filter((node) => node.getBoundingClientRect().width > 2 && !clipped(node))
                    .map((node) => ({
                        name: `${node.tagName.toLowerCase()} ${node.className.toString().slice(0, 50)} ${node.textContent.slice(0, 20)}`,
                        right: client - node.getBoundingClientRect().right,
                    }));
            });

            expect(gaps.filter((gap) => gap.right < GUTTER - 0.5)).toEqual([]);

            // Every block the article is made of sits at the page gutter on BOTH sides (16 px below 600).
            const blocks = await page.evaluate(() => {
                const client = document.documentElement.clientWidth;

                return Array.from(document.querySelectorAll('article > *'))
                    .filter((node) => node.getBoundingClientRect().width > 2)
                    .map((node) => {
                        const box = node.getBoundingClientRect();

                        return { name: node.tagName.toLowerCase(), left: box.left, right: client - box.right };
                    });
            });

            expect(blocks.length).toBeGreaterThan(2);
            expect(
                blocks.filter((block) => Math.abs(block.left - GUTTER) > 0.5 || Math.abs(block.right - GUTTER) > 0.5),
            ).toEqual([]);

            const widths = await page.evaluate(() => ({
                scroll: document.documentElement.scrollWidth,
                client: document.documentElement.clientWidth,
            }));

            expect(widths.scroll).toBe(widths.client);
        });

        test('the pinned ingredients bar appears in the steps as one button, and the list opens and closes', async ({
            page,
        }) => {
            await openRecipe(page);
            const bar = page.getByRole('button', { name: /^Ingredients for 4, 13 items\. Show list\.$/u });

            await expect(bar).toBeHidden();
            await scrollIntoSteps(page);
            await expect(bar).toBeVisible();
            await expect(bar).toHaveAttribute('aria-expanded', 'false');
            await expect(bar).toHaveAttribute('aria-haspopup', 'dialog');

            await bar.click();

            const panel = page.getByRole('dialog', { name: 'Ingredients for 4' });

            await expect(panel).toBeVisible();
            await expect(page.getByRole('button', { name: /Hide list\.$/u })).toHaveAttribute('aria-expanded', 'true');
            // The servings stepper is the first control in the panel, never in the bar.
            await expect(panel.getByRole('group', { name: 'Servings' })).toBeVisible();

            // A tick in the panel is the card's tick.
            await panel.getByRole('checkbox', { name: /ingredient number 3/u }).check();
            await page.getByRole('button', { name: /Hide list\.$/u }).click();
            await expect(panel).toBeHidden();
            await expect(page.getByRole('button', { name: /1 ticked\. Show list\.$/u })).toBeVisible();

            // The scrim closes it: pressed in the 12 px beside the panel, clear of the bar and the tab bar.
            await page.getByRole('button', { name: /Show list\.$/u }).click();
            await expect(panel).toBeVisible();
            await page.mouse.click(5, 400);
            await expect(panel).toBeHidden();

            // Escape closes it, and focus goes back to the bar.
            await page.getByRole('button', { name: /Show list\.$/u }).click();
            await expect(panel).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            await expect(page.getByRole('button', { name: /Show list\.$/u })).toBeFocused();
        });

        test('a list left open is closed when the window grows to a 720 px body, and the page scrolls again', async ({
            page,
        }) => {
            await openRecipe(page);
            // The foot of the page: wide, the sticky card has run out of column and ends up above the window too.
            await page.evaluate(() => {
                window.scrollTo(0, document.documentElement.scrollHeight);
            });
            await page.getByRole('button', { name: /Show list\.$/u }).click();
            await expect(page.getByRole('dialog', { name: 'Ingredients for 4' })).toBeVisible();

            await page.setViewportSize({ width: 1280, height: 800 });

            // The observer reports the hidden marker one frame later, and the list closes then: poll, do not read once.
            await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('');
            await expect(page.locator('[inert]')).toHaveCount(0);
        });

        test('the bar is gone when the ingredients card is back in view', async ({ page }) => {
            await openRecipe(page);
            await scrollIntoSteps(page);
            await expect(page.getByRole('button', { name: /Show list\.$/u })).toBeVisible();

            await page.getByRole('heading', { name: 'Ingredients', level: 2 }).scrollIntoViewIfNeeded();
            await expect(page.getByRole('button', { name: /Show list\.$/u })).toBeHidden();
        });
    });
}

test.describe('recipe page at 1280 px', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the bar never renders: the sticky column does its job', async ({ page }) => {
        await openRecipe(page);
        await scrollIntoSteps(page);

        await expect(page.getByRole('button', { name: /Show list\.$/u })).toHaveCount(0);
    });
});
