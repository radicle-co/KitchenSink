import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import { route } from './utils/basePath';
import { makeRecipeDetail, makeRecipeVersion, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * U5 — mobile-web responsive polish of the recipe/home surface, verified in the REAL browser at two
 * viewports (Next dev server + Clerk session + the client hooks + routing, with the recipe/identity HTTP
 * contract intercepted via `utils/recipeApi`). Two things are proven here that jsdom component tests cannot:
 *
 *  1. **375px (a phone):** no surface scrolls horizontally; the bottom tab bar sits pinned at the foot with
 *     ≥44px controls (it clears the home indicator via `env(safe-area-inset-bottom)` — 0 in headless, so the
 *     clearance itself is asserted by class in the component tests); the ingredient checkbox is a ≥44px tap
 *     target; and the version-compare A/B columns STACK to a single column.
 *  2. **1280px (desktop) is UNCHANGED:** the very same elements resolve to their original desktop values —
 *     the ingredient box is back to 24px, the detail title back to text-4xl (36px), version-compare is
 *     two-column, and the bottom tab bar is not rendered at all. A screenshot of the static detail article
 *     backs this as a future-drift guard. Every U5 change is a base/`sm:` addition restored at `md:`+ (or on
 *     `lg:hidden` chrome), so desktop is byte-identical by construction; these assertions hold that line.
 *
 * A third block covers the recipe LIST's own touch floors at 390×844 with a real touchscreen (`hasTouch`, so
 * the controls are `tap()`ped, not mouse-clicked). Those chips and tabs grew `min-h-11` (reset at `md:`), and a
 * touch floor is only worth anything if the enlarged control still WORKS: each assertion pairs the ≥44px box
 * with the effect of tapping it, so a control that is merely tall enough — or one whose growth pushed the real
 * hit area under another element — fails.
 *
 * Selectors are role/label/text only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
const RECIPE_ID = 'rec_pasta';

const baseSnapshot: RecipeSnapshot = {
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast pasta dinner with a long enough title to test wrapping on a narrow phone screen.',
    steps: [{ id: 'step_1', recipeId: RECIPE_ID, stepNumber: 1, instruction: 'Boil water.' }],
    ingredients: [
        {
            id: 'ri_1',
            recipeId: RECIPE_ID,
            ingredientId: 'ing_olive_oil',
            quantity: 2,
            unit: 'tbsp',
            sortOrder: 1,
            ingredientName: 'Olive oil',
            isUserEntered: false,
        },
    ],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
};

// v2 changes the title; v3 (current) changes the description — so Compare has real changed fields to render.
const v2Snapshot: RecipeSnapshot = { ...baseSnapshot, version: 2, title: 'Weeknight Pasta with Garlic' };
const v3Snapshot: RecipeSnapshot = { ...v2Snapshot, version: 3, description: 'Updated: now with roasted garlic.' };

/** Sign in, seed one recipe (with versions) against the intercepted API, and land on Home. */
async function seed(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Weeknight Pasta with Garlic',
                description: baseSnapshot.description,
                ingredients: [
                    {
                        ingredientId: 'ing_olive_oil',
                        name: 'Olive oil',
                        quantity: 2,
                        unit: 'tbsp',
                        isUserEntered: false,
                    },
                ],
                currentVersion: 3,
            }),
        ],
        recipeVersions: {
            [RECIPE_ID]: [
                makeRecipeVersion({ versionNumber: 1, snapshot: baseSnapshot }),
                makeRecipeVersion({ versionNumber: 2, snapshot: v2Snapshot }),
                makeRecipeVersion({ versionNumber: 3, snapshot: v3Snapshot }),
            ],
        },
    });
}

/** The document must never scroll sideways — the canonical "fits the viewport" assertion. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => {
        const el = document.documentElement;

        return el.scrollWidth - el.clientWidth;
    });
    // Allow a 1px rounding slack; anything more is a real horizontal scrollbar.
    expect(overflow).toBeLessThanOrEqual(1);
}

/** Open the version-compare panel (selecting v2 + v3) and return its A/B header grid's parent element handle. */
async function openCompare(page: Page): Promise<void> {
    await page.goto(route(`/recipes/${RECIPE_ID}/versions`));
    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select version 2 to compare' }).click();
    await page.getByRole('checkbox', { name: 'Select version 3 to compare' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
}

/** Count the rendered grid tracks of the compare A/B column header (1 = stacked, 2 = side-by-side). */
async function compareColumnCount(page: Page): Promise<number> {
    const versionColumn = page.getByRole('dialog').getByText('Version 3');

    return versionColumn.evaluate((el) => {
        const parent = el.parentElement;

        if (parent === null) {
            return 0;
        }

        return getComputedStyle(parent).gridTemplateColumns.split(' ').filter(Boolean).length;
    });
}

test.describe('recipe/home responsive — 375px phone (U5)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('Home fits the viewport and the bottom tab bar is pinned at the foot with ≥44px controls', async ({
        page,
    }) => {
        await seed(page);
        await page.goto(route('/'));
        await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();

        await expectNoHorizontalOverflow(page);

        // The nav is named "Main" on every rendering (sidebar/tab bar/drawer); `getByRole` excludes hidden
        // elements from the a11y tree, so at 375px the desktop sidebar (display:none via `lg:flex`/`hidden`)
        // and the closed drawer drop out and the ONLY visible "Main" nav is the bottom tab bar.
        const tabBar = page.getByRole('navigation', { name: 'Main' });
        await expect(tabBar).toBeVisible();
        const box = await tabBar.boundingBox();
        expect(box).not.toBeNull();
        // A short bar pinned to the foot of the 812px viewport (not a full-height sidebar).
        expect(box?.height ?? 0).toBeLessThan(200);
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(812 - 2);

        // Every reachable destination is a ≥44px tap target.
        for (const link of await tabBar.getByRole('link').all()) {
            const linkBox = await link.boundingBox();
            expect(linkBox?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
    });

    test('the recipe list fits the viewport', async ({ page }) => {
        await seed(page);
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        await expectNoHorizontalOverflow(page);
    });

    test('the recipe detail fits the viewport and the ingredient checkbox is a ≥44px tap target', async ({ page }) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}`));
        await expect(page.getByRole('heading', { level: 1, name: 'Weeknight Pasta with Garlic' })).toBeVisible();

        await expectNoHorizontalOverflow(page);

        const checkbox = page.getByRole('checkbox', { name: /Olive oil/ });
        const box = await checkbox.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    });

    test('version-compare stacks the A/B columns into one', async ({ page }) => {
        await seed(page);
        await openCompare(page);

        expect(await compareColumnCount(page)).toBe(1);
    });
});

test.describe('recipe/home responsive — 1280px desktop is unchanged (U5)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the desktop nav is the full-height sidebar, not the bottom tab bar', async ({ page }) => {
        await seed(page);
        await page.goto(route('/'));
        await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();

        // `lg:hidden` collapses the tab bar to display:none (excluded from the a11y tree), so the only visible
        // "Main" nav at 1280px is the desktop sidebar — a tall left rail, never a short bottom bar. That the
        // visible nav spans most of the viewport height proves the tab bar did not leak onto desktop.
        const nav = page.getByRole('navigation', { name: 'Main' });
        await expect(nav).toBeVisible();
        const box = await nav.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThan(400);
    });

    test('the detail title keeps its 36px (text-4xl) size and the ingredient box its 24px', async ({ page }) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}`));
        const heading = page.getByRole('heading', { level: 1, name: 'Weeknight Pasta with Garlic' });
        await expect(heading).toBeVisible();

        // text-4xl = 2.25rem = 36px — the base text-2xl must NOT leak onto desktop.
        const fontSize = await heading.evaluate((el) => getComputedStyle(el).fontSize);
        expect(fontSize).toBe('36px');

        // The ingredient tap target returns to its original 24px (size-5) box on desktop (sm:size-5).
        const checkbox = page.getByRole('checkbox', { name: /Olive oil/ });
        const box = await checkbox.boundingBox();
        expect(Math.round(box?.width ?? 0)).toBe(24);
        expect(Math.round(box?.height ?? 0)).toBe(24);

        // Future-drift guard: the static detail article stays visually stable at desktop width.
        await expect(page.getByRole('article', { name: 'Weeknight Pasta with Garlic' })).toHaveScreenshot(
            'recipe-detail-desktop.png',
            { maxDiffPixelRatio: 0.02 },
        );
    });

    test('version-compare keeps the two side-by-side A/B columns', async ({ page }) => {
        await seed(page);
        await openCompare(page);

        expect(await compareColumnCount(page)).toBe(2);
    });
});

/** The measured height of a control, in CSS px. */
async function heightOf(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();

    expect(box).not.toBeNull();

    return box?.height ?? 0;
}

/**
 * Seed the recipe LIST with one recipe inside the Quick (<30m) bucket and one outside it, so the quick-filter
 * chip both APPEARS (it is data-driven — no qualifying recipe, no chip) and has something to narrow away.
 */
async function seedQuickAndSlow(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({ id: 'rec_quick', ownerId: viewerId, title: 'Overnight Oats', totalTimeMinutes: 5 }),
            makeRecipeDetail({ id: 'rec_slow', ownerId: viewerId, title: 'Sunday Ragu', totalTimeMinutes: 240 }),
        ],
    });
}

test.describe('recipe list touch targets — 390×844 phone with a touchscreen', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('tapping the Quick (<30m) chip clears the 44px floor AND applies the filter', async ({ page }) => {
        await seedQuickAndSlow(page);
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        const chips = page.getByRole('group', { name: 'Quick filters' });
        const allChip = chips.getByRole('button', { name: 'All' });
        const quickChip = chips.getByRole('button', { name: 'Quick (<30m)' });

        // Both chips are ≥44px tall at phone width (`min-h-11`, reset at `md:` for the desktop density).
        expect(await heightOf(allChip)).toBeGreaterThanOrEqual(44);
        expect(await heightOf(quickChip)).toBeGreaterThanOrEqual(44);

        // Nothing is filtered yet: "All" is the pressed chip and both recipes are listed.
        await expect(allChip).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Overnight Oats' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday Ragu' })).toBeVisible();

        // A real TAP (touchstart/touchend, not a mouse click) must apply the filter.
        await quickChip.tap();

        await expect(quickChip).toHaveAttribute('aria-pressed', 'true');
        await expect(allChip).toHaveAttribute('aria-pressed', 'false');
        // The 240-minute recipe leaving the list is the assertion that matters — it can only happen if the
        // tap actually reached the chip's handler.
        await expect(page.getByRole('button', { name: 'Sunday Ragu' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Overnight Oats' })).toBeVisible();

        // Tapping "All" restores the full list.
        await allChip.tap();
        await expect(page.getByRole('button', { name: 'Sunday Ragu' })).toBeVisible();
    });

    test('tapping the Community source tab clears the 44px floor AND switches source', async ({ page }) => {
        await seedQuickAndSlow(page);
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        const tabs = page.getByRole('tablist', { name: 'Recipe source' });
        const mine = tabs.getByRole('tab', { name: 'My Recipes' });
        const community = tabs.getByRole('tab', { name: 'Community' });

        expect(await heightOf(mine)).toBeGreaterThanOrEqual(44);
        expect(await heightOf(community)).toBeGreaterThanOrEqual(44);

        // This list IS "My Recipes", and the tab says so.
        await expect(mine).toHaveAttribute('aria-selected', 'true');
        await expect(community).toHaveAttribute('aria-selected', 'false');

        await community.tap();

        // L5: "Community" browses public recipes on the discovery surface — the tap has to actually get there.
        await expect(page).toHaveURL(/\/discover(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
    });
});
