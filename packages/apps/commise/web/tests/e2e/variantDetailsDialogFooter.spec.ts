import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FoodResponse, VariantView } from '@kitchensink/food-service-client';

import { signInWithTicket } from './utils/auth';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * Curated U14, the details dialog's footer (`docs/design/ingredientSpecialization.md` §S8.2 "Footer", §S10;
 * `docs/design/readSurfacesEvaluation.md` D2): below 640 px its buttons fill the footer, in the thumb zone; from 640 px
 * they keep their content width at the end of a row (R9, `docs/design/rowEditorOpenDecisions.md`).
 *
 * The dialog's one host is the row editor, so each test opens it from a saved line's `⋮`. Widths are measured in a real
 * browser, because jsdom lays nothing out. The footer column is the buttons' common parent.
 */

const ROOT_ID = 'food_chicken_breasts';
const ROOT_NAME = 'boneless skinless chicken breasts';
const RECIPE_ID = 'rec_details_footer';
const LINE_ID = '77777777-7777-4777-8777-7777777777d2';

const ROASTED: VariantView = {
    id: 'fdc:171477',
    parts: [{ attribute: 'cookingMethod', text: 'roasted' }],
    caloriesPer100g: 165,
};
const FRIED: VariantView = {
    id: 'fdc:171078',
    parts: [{ attribute: 'cookingMethod', text: 'fried' }],
    caloriesPer100g: 187,
};

/** The root as food answers it, with `variants` live. */
const rootWith = (variants: readonly VariantView[]): FoodResponse => ({
    id: ROOT_ID,
    name: ROOT_NAME,
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [],
    portions: [],
    provenance: {},
    variants: [...variants],
});

/**
 * Sign in, serve a saved recipe whose one line is bound to the `roasted` variant, answer the root's read with
 * `variants`, and open `Edit details` from the line's `⋮`.
 *
 * @returns The open dialog.
 */
async function openEditDetails(page: Page, variants: readonly VariantView[]): Promise<Locator> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Chicken supper',
                currentVersion: 1,
                ingredients: [
                    {
                        ingredientId: LINE_ID,
                        foodId: ROOT_ID,
                        name: ROOT_NAME,
                        variant: { id: ROASTED.id, parts: ROASTED.parts },
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'lb',
                        isUserEntered: false,
                        resolutionStatus: 'RESOLVED',
                    },
                ],
            }),
        ],
        foodNutrition: { [ROOT_ID]: { caloriesPer100g: 165, hasVariants: variants.length > 0 } },
    });
    // Only the root's exact path, so every other food read keeps its own handler.
    await page.route(`**/api/v1/foods/${ROOT_ID}`, (intercepted) => intercepted.fulfill({ json: rootWith(variants) }));

    await openRecipeEditor(page, RECIPE_ID);
    const ingredients = page.getByRole('region', { name: 'Ingredients' });

    await ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}, roasted` }).click();
    await page.getByRole('menuitem', { name: 'Edit details' }).click();
    const dialog = page.getByRole('dialog', { name: /Edit details/ });

    await expect(dialog).toBeVisible();

    return dialog;
}

/**
 * A button's box, the box of the footer column that holds it, and the dialog's width. The button sits in the Button
 * primitive's press wrapper, whose parent is the footer column.
 */
async function boxes(button: Locator) {
    return button.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const column = node.parentElement?.parentElement?.getBoundingClientRect();
        const dialog = node.closest('[role="dialog"]')?.getBoundingClientRect();

        return {
            button: { right: box.right, width: box.width },
            column: column === undefined ? null : { right: column.right, width: column.width },
            dialog: dialog === undefined ? null : { width: dialog.width },
        };
    });
}

test.describe('the details dialog’s footer below 640 px (curated U14, D2)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('Remove details fills the footer', async ({ page }) => {
        const dialog = await openEditDetails(page, [ROASTED, FRIED]);
        const remove = dialog.getByRole('button', { name: 'Remove details' });

        await expect(remove).toBeVisible();
        const measured = await boxes(remove);

        // Positive control: the footer column spans the sheet less its two 24 px gutters, so "as wide as the column" is
        // a claim about the full width and not about two equally narrow boxes.
        expect(measured.column?.width ?? 0).toBeGreaterThanOrEqual((measured.dialog?.width ?? 0) - 48);
        expect(measured.button.width, 'Remove details does not fill the footer').toBeGreaterThanOrEqual(
            (measured.column?.width ?? Number.POSITIVE_INFINITY) - 1,
        );
    });

    test('with no other details left, Close and Remove details both fill the footer', async ({ page }) => {
        const dialog = await openEditDetails(page, []);

        await expect(dialog.getByText(/There are no other details for/u)).toBeVisible();

        for (const name of ['Close', 'Remove details']) {
            const button = dialog.getByRole('button', { name, exact: true });

            await expect(button).toBeVisible();
            const measured = await boxes(button);

            expect(measured.column?.width ?? 0).toBeGreaterThanOrEqual((measured.dialog?.width ?? 0) - 48);
            expect(measured.button.width, `${name} does not fill the footer`).toBeGreaterThanOrEqual(
                (measured.column?.width ?? Number.POSITIVE_INFINITY) - 1,
            );
        }
    });
});

test.describe('the details dialog’s footer from 640 px (curated U14, R9)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('Remove details keeps its content width at the end of the row', async ({ page }) => {
        const dialog = await openEditDetails(page, [ROASTED, FRIED]);
        const remove = dialog.getByRole('button', { name: 'Remove details' });

        await expect(remove).toBeVisible();
        const measured = await boxes(remove);

        // The control for the test above: here the same button must NOT fill, so a footer that always stretched its
        // buttons would fail.
        expect(measured.button.width, 'Remove details stretched across a wide footer').toBeLessThan(
            (measured.column?.width ?? 0) / 2,
        );
        expect(
            Math.abs(measured.button.right - (measured.column?.right ?? 0)),
            'Remove details sits at the end',
        ).toBeLessThanOrEqual(1);
    });
});
