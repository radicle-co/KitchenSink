import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The two sticky columns on desktop, measured while the page is SCROLLED (owner report, 2026-11-08: "the ingredient bar
 * is not showing up when scrolling on desktop"):
 *
 *  - the recipe page's ingredients column, from a 720 px body (`buildSpec.md` §6.1: sticky, `top` = sticky chrome + 16,
 *    capped at the window, its own scroll), so it stays beside the steps while they scroll;
 *  - the editor's section rail, from a 960 px main column (§7.2: sticky under the header, `top` = header + 16).
 *
 * `recipeDetailCooking.spec.ts` asserts the column's computed `position` is `sticky`. That stayed green while the column
 * scrolled away with the page: a computed value says nothing about whether the box sticks. These tests scroll to the
 * last step and read where the box IS.
 *
 * Selectors are role and label only; no `waitForTimeout` (repo policy).
 */

const RECIPE_ID = 'ec000000-0000-4000-8000-0000000005c1';
const RECIPE_TITLE = 'Long Braised Short Ribs';
const STEP_COUNT = 24;
const LAST_STEP = `Step ${String(STEP_COUNT)}: rest the ribs in their liquid before serving.`;

/** Steps long enough that the page scrolls well past the ingredients at every width tested. */
const STEPS = Array.from({ length: STEP_COUNT }, (_, index) => ({
    stepNumber: index + 1,
    instruction:
        index + 1 === STEP_COUNT
            ? LAST_STEP
            : `Step ${String(index + 1)}: turn the ribs, baste them with the braising liquid, and check the oven, ` +
              'keeping the liquid at a bare simmer so the meat softens without drying at the edges of the pot.',
}));

/** Sign in and seed one long recipe the viewer owns. */
async function seedRecipe(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        paidFeatures: 'granted',
        recipes: [makeRecipeDetail({ id: RECIPE_ID, ownerId: viewerId, title: RECIPE_TITLE, steps: STEPS })],
    });
}

/** The box's top edge in the viewport, and its own computed sticky `top`, read in one frame. */
async function stickyReading(box: Locator): Promise<{ readonly top: number; readonly stickyTop: number }> {
    return box.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        stickyTop: Number.parseFloat(getComputedStyle(element).top),
    }));
}

/**
 * Scroll the page's end into view through whatever element scrolls (not `window.scrollTo`, which would prove nothing if
 * the document were not the scroller), and prove the page really moved far.
 */
async function scrollTo(last: Locator, scrolledPast: Locator): Promise<void> {
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // Far past the heading: the box we scrolled past now starts well above the top of the window.
    await expect.poll(async () => (await scrolledPast.boundingBox())?.y ?? 0).toBeLessThan(-300);
}

for (const width of [1280, 1920]) {
    test(`the recipe page keeps its ingredients in view while the steps scroll at ${String(width)}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedRecipe(page);
        await page.goto(route(`/recipes/${RECIPE_ID}`));
        await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();

        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        await scrollTo(page.getByText(LAST_STEP), page.getByRole('heading', { level: 1, name: RECIPE_TITLE }));

        const { top, stickyTop } = await stickyReading(ingredients);
        expect(stickyTop).toBeGreaterThan(0);
        expect(Math.abs(top - stickyTop)).toBeLessThanOrEqual(1);
        await expect(page.getByRole('heading', { level: 2, name: 'Ingredients' })).toBeInViewport();
    });
}

for (const width of [1280, 1920]) {
    test(`the editor keeps its section rail in view while the form scrolls at ${String(width)}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedRecipe(page);
        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await expect(page.getByRole('heading', { level: 2, name: 'Steps' })).toBeVisible();

        const rail = page.getByRole('navigation', { name: 'Recipe sections' });
        await expect(rail).toBeVisible();
        // Photos is the editor's last section, below every step field.
        await scrollTo(
            page.getByRole('heading', { level: 2, name: 'Photos' }),
            page.getByRole('heading', { level: 2, name: 'Steps' }),
        );

        const { top, stickyTop } = await stickyReading(rail);
        expect(stickyTop).toBeGreaterThan(0);
        expect(Math.abs(top - stickyTop)).toBeLessThanOrEqual(1);
        await expect(rail.getByRole('link', { name: 'Steps' })).toBeInViewport();
    });
}
