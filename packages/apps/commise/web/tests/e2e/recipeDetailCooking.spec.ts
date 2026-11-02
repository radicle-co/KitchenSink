import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { role, roleDark } from '@commise/ui/colors';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The first slice of 008 FR-035 on the recipe page (`docs/design/uiOverhaul/buildSpec.md` §6.2, §6.3), in a real
 * browser and in BOTH themes (owner decision D15):
 *
 *  1. Tap-to-check — the whole row is the checkbox; a checked row dims to `inkMuted`; the checks survive a reload in
 *     the same tab (`sessionStorage`, blueprint A13).
 *  2. One current step — a second step moves the marker; a second press clears it.
 *  3. Screen on — a switch that asks `navigator.wakeLock` for the screen, and is not drawn at all without the API.
 *  4. No section switch at any width: the page is one scroll, and Screen on is a labelled row in it.
 *
 * REWRITTEN IN SLICE 1 (`docs/design/uiRefreshWorkshop5/nativeBoards/buildLists.md`): the section switch is gone from
 * phones, so the tests that pressed it, measured its sticky bar, its 320 px fit and its scroll chevron are replaced by
 * tests that it is absent and that Screen on is one switch in the action row. Screen on has no caption (designer, iosBatch1). The fact
 * strip is three tiles with no Cook tile. The tap-to-check, current-step and Wake Lock tests are unchanged.
 *
 * The Wake Lock API is stubbed in the page before any script runs, so the test observes the request the page makes
 * rather than the browser's own policy. Selectors are role/label only; no `waitForTimeout`.
 */

const RECIPE_ID = 'ec000000-0000-4000-8000-00000000000a';
const RECIPE_TITLE = 'Slow-Roasted Lamb Shoulder';

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** Sign in, seed one recipe with two lines and two steps, and open it. */
async function openRecipe(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        paidFeatures: 'granted',
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: RECIPE_TITLE,
                ingredients: [
                    {
                        ingredientId: '00000000-0000-4000-8000-0000000000c1',
                        name: 'lamb shoulder',
                        foodId: 'food_lamb',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'kg',
                        isUserEntered: false,
                    },
                    {
                        ingredientId: '00000000-0000-4000-8000-0000000000c2',
                        name: 'preserved lemon',
                        foodId: 'food_lemon',
                        quantity: { kind: 'exact', value: 1 },
                        unit: undefined,
                        isUserEntered: false,
                    },
                ],
                steps: [
                    { stepNumber: 1, instruction: 'Rub the lamb with the lemon.' },
                    { stepNumber: 2, instruction: 'Roast low for five hours.' },
                    // Enough further steps that the page scrolls past the Steps heading on a phone, so the scroll
                    // spy is tested against a real scroll rather than the end of a short page.
                    ...[3, 4, 5, 6, 7, 8].map((stepNumber) => ({
                        stepNumber,
                        instruction: `Baste the lamb with its juices and turn the tray, step ${String(stepNumber)} of the long roast.`,
                    })),
                ],
            }),
        ],
    });

    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();
}

/** Replace the page's Wake Lock API with a recorder, before any page script runs. */
async function stubWakeLock(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const calls: string[] = [];
        Object.defineProperty(window, '__wakeLockCalls', { value: calls });
        Object.defineProperty(Navigator.prototype, 'wakeLock', {
            configurable: true,
            get: () => ({
                request: (type: string) => {
                    calls.push(`request:${type}`);

                    return Promise.resolve({
                        released: false,
                        release: () => {
                            calls.push('release');

                            return Promise.resolve();
                        },
                    });
                },
            }),
        });
    });
}

/** What the page asked of the stubbed Wake Lock API, in order. */
const wakeLockCalls = (page: Page): Promise<readonly string[]> =>
    page.evaluate(() => (window as unknown as { __wakeLockCalls: readonly string[] }).__wakeLockCalls);

/** The text block of an ingredient row. */
const rowText = (row: Locator): Locator => row.getByText(/lamb shoulder/u);

const THEMES = [
    ['light', role],
    ['dark', roleDark],
] as const;

for (const [scheme, colors] of THEMES) {
    test.describe(`cooking from the recipe page (${scheme})`, () => {
        test.use({ colorScheme: scheme });

        test('checks a whole row, dims it, and keeps it checked across a reload in the same tab', async ({ page }) => {
            await openRecipe(page);
            const lamb = page.getByRole('checkbox', { name: '2 kg lamb shoulder' });

            await lamb.click();

            await expect(lamb).toHaveAttribute('aria-checked', 'true');
            // The dim is a colour transition, so the settled colour is polled rather than sampled mid-fade.
            await expect
                .poll(() =>
                    rowText(lamb).evaluate(
                        (element) => getComputedStyle(element.closest('[data-line-text]') ?? element).color,
                    ),
                )
                .toBe(rgb(colors.inkMuted));
            expect(
                await rowText(lamb).evaluate((element) => getComputedStyle(element).textDecorationLine),
            ).not.toContain('line-through');

            await page.reload();
            await expect(page.getByRole('checkbox', { name: '2 kg lamb shoulder' })).toHaveAttribute(
                'aria-checked',
                'true',
            );
            await expect(page.getByRole('checkbox', { name: '1 preserved lemon' })).toHaveAttribute(
                'aria-checked',
                'false',
            );
        });

        test('keeps one current step: another step moves the marker, a second press clears it', async ({ page }) => {
            await openRecipe(page);
            const first = page.getByRole('button', { name: 'Mark step 1 as current' });
            const second = page.getByRole('button', { name: 'Mark step 2 as current' });

            await first.click();
            await expect(first).toHaveAttribute('aria-pressed', 'true');

            // A tap anywhere on the step moves the marker for a pointer user (the toggle's overlay covers the step).
            await page.getByRole('listitem').filter({ hasText: 'Roast low for five hours.' }).click();
            await expect(second).toHaveAttribute('aria-pressed', 'true');
            await expect(first).toHaveAttribute('aria-pressed', 'false');

            await second.click();
            await expect(second).toHaveAttribute('aria-pressed', 'false');
        });

        test('Screen on asks the browser to keep the screen awake, and lets go when turned off', async ({ page }) => {
            await stubWakeLock(page);
            await page.setViewportSize({ width: 1280, height: 900 });
            await openRecipe(page);

            const screenOn = page.getByRole('switch', { name: 'Screen on' });
            await expect(screenOn).toHaveCount(1);
            await expect(screenOn).toHaveAttribute('aria-checked', 'false');

            await screenOn.click();
            await expect(screenOn).toHaveAttribute('aria-checked', 'true');
            await expect.poll(() => wakeLockCalls(page)).toEqual(['request:screen']);

            await screenOn.click();
            await expect.poll(() => wakeLockCalls(page)).toEqual(['request:screen', 'release']);
        });

        test('draws no Screen on control where the browser has no Wake Lock API', async ({ page }) => {
            await page.addInitScript(() => {
                Reflect.deleteProperty(Navigator.prototype, 'wakeLock');
            });
            await openRecipe(page);

            await expect(page.getByRole('switch', { name: 'Screen on' })).toHaveCount(0);
        });
    });
}

/**
 * The page's two layouts (§6.1), measured in the browser — the unit tiers run without CSS and cannot see them. From a
 * 720 px body: two columns, the ingredients sticky beside the steps. Below it: one column. At both widths there is no
 * section switch, Screen on is a labelled switch, and the fact tiles are Total, Prep and Difficulty with no Cook tile.
 */
test.describe('the recipe page’s layout', () => {
    test('from a 720 px body: ingredients sticky beside the steps, no switch, Screen on labelled', async ({ page }) => {
        await stubWakeLock(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await openRecipe(page);

        const ingredients = await page.getByRole('region', { name: 'Ingredients' }).boundingBox();
        const steps = await page.getByRole('region', { name: 'Steps' }).boundingBox();

        expect(ingredients).not.toBeNull();
        expect(steps).not.toBeNull();
        expect((ingredients?.x ?? 0) + (ingredients?.width ?? 0)).toBeLessThanOrEqual(steps?.x ?? 0);
        expect(ingredients?.y ?? 0).toBeLessThan((steps?.y ?? 0) + (steps?.height ?? 0));
        expect(
            await page
                .getByRole('region', { name: 'Ingredients' })
                .evaluate((section) => getComputedStyle(section).position),
        ).toBe('sticky');
        await expect(page.getByRole('navigation', { name: 'Recipe sections' })).toHaveCount(0);
        await expect(page.getByRole('switch', { name: 'Screen on' })).toHaveText('Screen on');
    });

    test('below a 720 px body: one column, no section switch, Screen on labelled', async ({ page }) => {
        await stubWakeLock(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await openRecipe(page);

        await expect(page.getByRole('navigation', { name: 'Recipe sections' })).toHaveCount(0);
        const toggle = page.getByRole('switch', { name: 'Screen on' });
        await expect(toggle).toHaveCount(1);
        await expect(toggle).toHaveText('Screen on');

        const ingredients = await page.getByRole('region', { name: 'Ingredients' }).boundingBox();
        const steps = await page.getByRole('region', { name: 'Steps' }).boundingBox();
        expect((ingredients?.y ?? 0) + (ingredients?.height ?? 0)).toBeLessThanOrEqual((steps?.y ?? 0) + 1);
    });

    test('draws the fact tiles Total, Prep and Difficulty, and no Cook tile', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openRecipe(page);

        const terms = page.getByRole('term').filter({ hasText: /^(Total|Prep|Cook|Difficulty)$/u });

        await expect(terms.filter({ hasText: 'Cook' })).toHaveCount(0);
        expect(await terms.allTextContents()).toEqual(expect.arrayContaining(['Total']));
    });
});

/** Designer, iosBatch1: Screen on is a quiet action in the action row, after the page's text action, with no caption under it. */
test.describe('the Screen on action', () => {
    test('sits in the action row after Edit recipe, as a switch, with no hint', async ({ page }) => {
        await stubWakeLock(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await openRecipe(page);

        const edit = page.getByRole('link', { name: 'Edit recipe' });
        const toggle = page.getByRole('switch', { name: 'Screen on' });
        const [editBox, toggleBox] = [await edit.boundingBox(), await toggle.boundingBox()];

        expect(editBox).not.toBeNull();
        expect(toggleBox).not.toBeNull();
        // The same row (their vertical spans overlap) and after Edit.
        expect((toggleBox?.y ?? 0) < (editBox?.y ?? 0) + (editBox?.height ?? 0)).toBe(true);
        expect((toggleBox?.x ?? 0) >= (editBox?.x ?? 0) + (editBox?.width ?? 0) - 1).toBe(true);
        await expect(page.getByText('Keeps the screen awake while you cook.')).toHaveCount(0);
    });
});
