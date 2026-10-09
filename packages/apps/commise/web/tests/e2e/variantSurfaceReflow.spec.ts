import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { RecipeIngredientView, RecipeSnapshot } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockFoodApi } from './utils/foodApi';
import { makeRecipeDetail, makeRecipeVersion, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * Curated U15 — no read surface scrolls sideways (`docs/design/ingredientSpecialization.md` §S10, §S18, E2).
 *
 * This spec runs ONLY in the two reflow projects of `playwright.config.ts`, which test WCAG's two conditions apart,
 * because WCAG never combines them: `reflow320` (320 × 640 at 100% text, SC 1.4.10) and `text200` (640 × 360 with the
 * root font at 200%, SC 1.4.4). The theme sizes text and spacing in rem, so a 200% root grows both, as E2 measured.
 * At 320 px with 200% text the row's checkbox and quantity alone leave a name no room (E2), so that frame is a
 * measurement, not a gate.
 *
 * Each surface carries the longest variant line in the curated seed (103 characters, lamb rib roast) beside the two
 * KTD-16 roots. "No sideways scroll" is checked on the page and on every open dialog's own scroll box, because a
 * fixed dialog with `overflow-y: auto` scrolls inside itself while the page stays still.
 */

/** The root font scale a reflow project sets in its `metadata` (1 when absent). */
function textScaleOf(testInfo: TestInfo): number {
    const scale: unknown = testInfo.project.metadata['textScale'];

    return typeof scale === 'number' ? scale : 1;
}

/** Apply the project's text scale to the page as it stands; the style survives client-side navigation. */
async function applyTextScale(page: Page, testInfo: TestInfo): Promise<void> {
    const scale = textScaleOf(testInfo);

    if (scale !== 1) {
        await page.addStyleTag({ content: `html { font-size: ${String(scale * 100)}% !important; }` });
    }
}

/** Assert that neither the page nor any open dialog scrolls sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'), (box) => box.scrollWidth - box.clientWidth),
    }));

    expect(overflow.page, 'the page scrolls sideways').toBeLessThanOrEqual(0);

    for (const dialog of overflow.dialogs) {
        expect(dialog, 'a dialog scrolls sideways').toBeLessThanOrEqual(0);
    }
}

const RECIPE_ID = 'db000000-0000-4000-8000-0000000000e1';

const LAMB_PARTS = [
    { attribute: 'cut', text: 'rack roast' },
    { attribute: 'bone', text: 'frenched' },
    { attribute: 'fat', text: 'separable lean and fat' },
    { attribute: 'trim', text: 'denuded' },
    { attribute: 'trim', text: '0-inch trim' },
    { attribute: 'cookingMethod', text: 'roasted' },
    { attribute: 'origin', text: 'product of Australia' },
];

const BRISKET_PARTS = [
    { attribute: 'cut', text: 'flat half' },
    { attribute: 'fat', text: 'separable lean and fat' },
    { attribute: 'trim', text: '1/8-inch trim' },
    { attribute: 'grade', text: 'select' },
    { attribute: 'cookingMethod', text: 'braised' },
];

const LINES: readonly RecipeIngredientView[] = [
    {
        ingredientId: 'db000000-0000-4000-8000-0000000000e2',
        name: 'beef brisket',
        foodId: 'food_beef_brisket',
        hasVariants: true,
        quantity: { kind: 'exact', value: 1 },
        unit: 'lb',
        isUserEntered: false,
    },
    {
        ingredientId: 'db000000-0000-4000-8000-0000000000e3',
        name: 'beef brisket',
        foodId: 'food_beef_brisket',
        variant: { id: 'fdc:169432', parts: BRISKET_PARTS },
        quantity: { kind: 'exact', value: 2 },
        unit: 'lb',
        preparation: 'sliced against the grain',
        isUserEntered: false,
    },
    {
        ingredientId: 'db000000-0000-4000-8000-0000000000e4',
        name: 'lamb rib roast',
        foodId: 'food_lamb_rib_roast',
        variant: { id: 'fdc:174370', parts: LAMB_PARTS },
        quantity: { kind: 'exact', value: 1 },
        unit: 'rack',
        isUserEntered: false,
    },
    {
        ingredientId: 'db000000-0000-4000-8000-0000000000e5',
        name: 'boneless skinless chicken breasts',
        foodId: 'food_boneless_skinless_chicken_breasts',
        quantity: { kind: 'exact', value: 4 },
        isUserEntered: false,
        resolutionStatus: 'AMBIGUOUS',
    },
    {
        ingredientId: 'db000000-0000-4000-8000-0000000000e6',
        name: 'Grandma’s spice mix',
        quantity: { kind: 'exact', value: 1 },
        unit: 'tbsp',
        isUserEntered: true,
    },
];

/** The same lines as a version froze them. */
const SNAPSHOT: RecipeSnapshot = {
    version: 1,
    title: 'Reflow Roast',
    description: 'Every read surface at its narrowest.',
    servings: 4,
    prepTimeMinutes: 20,
    cookTimeMinutes: 180,
    steps: [{ id: 'step_1', recipeId: RECIPE_ID, stepNumber: 1, instruction: 'Roast low and slow.' }],
    ingredients: LINES.map((line, index) => ({
        id: `ri_${String(index)}`,
        recipeId: RECIPE_ID,
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        unit: line.unit ?? '',
        sortOrder: index + 1,
        ...(line.name === undefined ? {} : { ingredientName: line.name }),
        ...(line.variant === undefined ? {} : { variantParts: line.variant.parts }),
        isUserEntered: line.isUserEntered,
    })),
};

/** Sign in, seed the recipe and its two versions, and return to a page with the scale applied. */
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
                title: 'Reflow Roast',
                ingredients: [...LINES],
                currentVersion: 2,
            }),
            makeRecipeDetail({
                id: 'db000000-0000-4000-8000-0000000000e9',
                ownerId: 'usr_other',
                title: 'Weeknight Ramen Bowl',
            }),
        ],
        recipeVersions: {
            [RECIPE_ID]: [
                makeRecipeVersion({ id: 'ver_r1', recipeId: RECIPE_ID, versionNumber: 1, snapshot: SNAPSHOT }),
                makeRecipeVersion({
                    id: 'ver_r2',
                    recipeId: RECIPE_ID,
                    versionNumber: 2,
                    snapshot: { ...SNAPSHOT, version: 2, description: 'Narrower still.' },
                }),
            ],
        },
    });
    // Plan 002 S5: the ambiguity review's shortlist and the editor's search read food's own search.
    await mockFoodApi(page);
}

test.describe('the read surfaces do not scroll sideways (curated U15, WCAG 1.4.10 and 1.4.4)', () => {
    test('the recipe read view, with its variant lines and the nutrition note', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}`));
        await applyTextScale(page, testInfo);

        await expect(page.getByRole('heading', { name: 'Reflow Roast' })).toBeVisible();
        await expect(
            page.getByRole('checkbox', {
                name: '1 rack lamb rib roast, rack roast, frenched, separable lean and fat, denuded, 0-inch trim, roasted, product of Australia',
            }),
        ).toBeVisible();
        await expect(page.getByRole('link', { name: 'Data sources' })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    test('the recipe editor’s ingredient step, with its variant lines', async ({ page }, testInfo) => {
        await seed(page);
        await openRecipeEditor(page, RECIPE_ID);
        await applyTextScale(page, testInfo);

        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await expect(ingredients.getByLabel('Ingredient 1 name')).toBeVisible();
        await expect(ingredients.getByText('product of Australia').first()).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    test('the ambiguity review, open', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}`));
        await applyTextScale(page, testInfo);

        await page.getByRole('button', { name: 'Review ingredient matches' }).click();
        await expect(page.getByRole('button', { name: 'Pepper, black, ground' })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    test('the version preview', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}/versions`));
        await applyTextScale(page, testInfo);

        await page.getByRole('button', { name: 'More actions for version 1' }).click();
        await page.getByRole('menuitem', { name: 'Preview' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    // Both frames are the filter Sheet's layout (spec §S8.1a): 320 px is narrow, and 360 px is short.
    test('the recipe filter Sheet, with an ingredient chip and results', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(
            route('/discover?foodId=food_boneless_skinless_chicken_breasts&foodName=boneless+skinless+chicken+breasts'),
        );
        await applyTextScale(page, testInfo);

        await page.getByRole('button', { name: 'Filters, 1 active' }).click();
        const sheet = page.getByRole('dialog', { name: 'Filters' });
        await expect(sheet.getByRole('button', { name: 'Remove boneless skinless chicken breasts' })).toBeVisible();
        await sheet.getByRole('searchbox', { name: 'Has ingredient' }).fill('sal');
        await expect(sheet.getByRole('button', { name: 'Filter by Salt' })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    // Slice 8: the paste page and its review are retired; Paste a list is a sheet in the editor's Ingredients section, and
    // the pasted lines are rows of its list (build spec §7.5.4).
    test('the Paste a list sheet', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(route('/recipes/new?paste=1#ingredients'));
        await applyTextScale(page, testInfo);

        const sheet = page.getByRole('dialog', { name: 'Paste a list' });
        await sheet
            .getByRole('textbox', { name: 'Ingredient lines' })
            .fill('2 lb beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised');
        await expect(sheet.getByRole('button', { name: 'Add 1 ingredient' })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    test('pasted lines reading in the Ingredients section', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(route('/recipes/new?paste=1#ingredients'));

        const sheet = page.getByRole('dialog', { name: 'Paste a list' });
        await sheet
            .getByRole('textbox', { name: 'Ingredient lines' })
            .fill('2 lb beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised');
        await sheet.getByRole('button', { name: 'Add 1 ingredient' }).click();
        await applyTextScale(page, testInfo);

        await expect(page.getByRole('list', { name: 'Ingredients' }).getByRole('listitem').first()).toBeVisible();
        await expectNoSidewaysScroll(page);
    });
});
