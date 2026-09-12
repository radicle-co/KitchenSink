import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { RecipeIngredientView, RecipeSnapshot } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockFoodApi } from './utils/foodApi';
import { makeRecipeDetail, makeRecipeVersion, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

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
        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await applyTextScale(page, testInfo);
        await page.getByRole('button', { name: /Ingredients:/ }).click();

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

        await page.getByRole('button', { name: 'Preview version 1' }).click();
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
        const sheet = page.getByRole('dialog', { name: 'Filter recipes' });
        await expect(sheet.getByRole('button', { name: 'Remove boneless skinless chicken breasts' })).toBeVisible();
        await sheet.getByRole('searchbox', { name: 'Search ingredients' }).fill('sal');
        await expect(sheet.getByRole('button', { name: 'Filter by Salt' })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    test('the paste form’s stacked buttons fill the form’s width below 640 px', async ({ page }, testInfo) => {
        // Below `sm` the two controls stack, full width, so the primary sits in the thumb zone with a full-width
        // target (`ParsePasteForm.tsx`). The text field beside them fills the form, so it is the width to match.
        test.skip(testInfo.project.name !== 'reflow320', 'the buttons stack only below 640 px wide');
        await seed(page);
        await page.goto(route('/recipes/parse'));
        await applyTextScale(page, testInfo);

        const fieldControl = page.getByLabel('Ingredient lines');

        await expect(fieldControl).toBeVisible();
        const fieldWidth = (await fieldControl.boundingBox())?.width ?? 0;

        // Positive control: the field fills the 320 px form less its gutters, so the comparison below is not vacuous.
        expect(fieldWidth).toBeGreaterThan(250);

        for (const name of ['Back to recipes', 'Read my ingredients']) {
            const button = page.getByRole('button', { name });

            await expect(button).toBeVisible();
            expect((await button.boundingBox())?.width ?? 0, `${name} does not fill the form`).toBeGreaterThanOrEqual(
                fieldWidth - 1,
            );
        }

        await expectNoSidewaysScroll(page);
    });

    test('the paste form’s buttons share one row from 640 px', async ({ page }, testInfo) => {
        // From `sm` the parent is a row, and a filled button keeps its content width in a row (R9,
        // `docs/design/rowEditorOpenDecisions.md`), so the two actions sit side by side. A label may wrap at 200% text.
        test.skip((testInfo.project.use.viewport?.width ?? 0) < 640, 'the buttons share a row only from 640 px wide');
        await seed(page);
        await page.goto(route('/recipes/parse'));
        await applyTextScale(page, testInfo);

        const back = page.getByRole('button', { name: 'Back to recipes' });
        const submit = page.getByRole('button', { name: 'Read my ingredients' });

        await expect(back).toBeVisible();
        await expect(submit).toBeVisible();
        const backBox = await back.boundingBox();
        const submitBox = await submit.boundingBox();

        // Positive control: both actions were laid out, so the comparison below is not between two missing boxes.
        expect(backBox?.width ?? 0).toBeGreaterThan(0);
        expect(submitBox?.width ?? 0).toBeGreaterThan(0);
        // Vertical centres, not tops: one line holds whether the row stretches its items or centres them.
        const middle = (box: typeof backBox): number => (box?.y ?? 0) + (box?.height ?? 0) / 2;
        expect(Math.abs(middle(backBox) - middle(submitBox)), 'the two actions sit on one line').toBeLessThanOrEqual(1);
        expect((backBox?.x ?? 0) + (backBox?.width ?? 0), 'Back sits before the submit').toBeLessThanOrEqual(
            (submitBox?.x ?? 0) + 1,
        );
        await expectNoSidewaysScroll(page);
    });

    test('the import review', async ({ page }, testInfo) => {
        await seed(page);
        await page.goto(route('/recipes/parse'));

        await page
            .getByLabel('Ingredient lines')
            .fill('2 lb beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised');
        const created = page.waitForResponse(
            (response) =>
                response.url().endsWith('/api/v1/recipe-parse-jobs') && response.request().method() === 'POST',
        );
        await page.getByRole('button', { name: 'Read my ingredients' }).click();
        // Opened at its own address, so this measures the review's layout alone. The paste form's hand-off to the
        // review is `parseIngredients.spec.ts`'s.
        const { id } = (await (await created).json()) as { readonly id: string };
        await page.goto(route(`/recipes/parse/${id}`));
        await applyTextScale(page, testInfo);

        await expect(page.getByRole('heading', { name: 'Your ingredients', exact: true })).toBeVisible({
            timeout: 20_000,
        });
        await expect(page.getByRole('listitem', { name: 'Line 1' })).toBeVisible({ timeout: 20_000 });
        await expectNoSidewaysScroll(page);
    });
});
