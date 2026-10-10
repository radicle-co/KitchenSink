import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * Curated U15, read view: a variant-bound line keeps its quantity in the name's line, and its checkbox beside that
 * line (`docs/design/variantDetailsMockup.html` frame 1; `docs/design/ingredientSpecialization.md` §S5 and the E2
 * re-check; `docs/design/readSurfacesEvaluation.md` D1).
 *
 * A variant-bound line is two lines or more: the name, then the dotted line. Each measurement below is taken in a real
 * browser, because jsdom lays nothing out. The checkbox's box is centred in its 44 px target, so the target's centre is
 * the box's centre.
 */

const RECIPE_ID = 'db000000-0000-4000-8000-0000000000d1';

const BRISKET_PARTS = [
    { attribute: 'cut', text: 'flat half' },
    { attribute: 'fat', text: 'separable lean and fat' },
    { attribute: 'trim', text: '1/8-inch trim' },
    { attribute: 'grade', text: 'select' },
    { attribute: 'cookingMethod', text: 'braised' },
];

const ROOT_LINE: RecipeIngredientView = {
    ingredientId: 'db000000-0000-4000-8000-0000000000d2',
    name: 'beef brisket',
    foodId: 'food_beef_brisket',
    hasVariants: true,
    quantity: { kind: 'exact', value: 1 },
    unit: 'lb',
    isUserEntered: false,
};

const VARIANT_LINE: RecipeIngredientView = {
    ingredientId: 'db000000-0000-4000-8000-0000000000d3',
    name: 'beef brisket',
    foodId: 'food_beef_brisket',
    variant: { id: 'fdc:169432', parts: BRISKET_PARTS },
    quantity: { kind: 'exact', value: 2 },
    unit: 'lb',
    isUserEntered: false,
};

/** A vertical span on the page, in CSS pixels. */
interface Span {
    readonly top: number;
    readonly bottom: number;
}

/** What one row measures: the first line box of each text, and the checkbox's target. */
interface RowGeometry {
    readonly quantity: Span | null;
    readonly name: Span | null;
    readonly firstPart: Span | null;
    readonly checkbox: Span | null;
}

const middle = (span: Span): number => (span.top + span.bottom) / 2;

/** Sign in, and serve one recipe with a root-bound line and a variant-bound line. */
async function seed(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Braised Brisket',
                ingredients: [ROOT_LINE, VARIANT_LINE],
            }),
        ],
    });
}

/** The list item holding the checkbox named `name`. */
function rowOf(page: Page, name: string): Locator {
    return page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name, exact: true }) });
}

/**
 * Measure a row: the FIRST line box of the quantity, of the name and of the first part (each a text node, through a
 * `Range`), and the checkbox's target.
 */
async function measure(row: Locator, texts: { quantity: string; name: string; firstPart?: string }) {
    return row.evaluate((item, wanted): RowGeometry => {
        const firstLineOf = (text: string | undefined): Span | null => {
            if (text === undefined) {
                return null;
            }

            const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);

            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                if (node.textContent?.trim() === text) {
                    const range = document.createRange();

                    range.selectNodeContents(node);
                    const box = range.getClientRects()[0];

                    if (box !== undefined) {
                        return { top: box.top, bottom: box.bottom };
                    }
                }
            }

            return null;
        };

        const target = item.querySelector('[role="checkbox"] [aria-hidden="true"]')?.getBoundingClientRect();

        return {
            quantity: firstLineOf(wanted.quantity),
            name: firstLineOf(wanted.name),
            firstPart: firstLineOf(wanted.firstPart),
            checkbox: target === undefined ? null : { top: target.top, bottom: target.bottom },
        };
    }, texts);
}

/** Assert the quantity sits in the name's first line box, and the checkbox is centred on that line. */
function expectQuantityAndCheckboxOnTheNameLine(geometry: RowGeometry): void {
    const { quantity, name, checkbox } = geometry;

    expect(quantity, 'the quantity was laid out').not.toBeNull();
    expect(name, 'the name was laid out').not.toBeNull();
    expect(checkbox, 'the checkbox was laid out').not.toBeNull();

    if (quantity === null || name === null || checkbox === null) {
        return;
    }

    expect(quantity.top, 'the quantity starts in the name’s first line').toBeGreaterThanOrEqual(name.top - 1);
    expect(quantity.bottom, 'the quantity ends in the name’s first line').toBeLessThanOrEqual(name.bottom + 1);
    expect(Math.abs(middle(checkbox) - middle(name)), 'the checkbox is centred on the name’s line').toBeLessThanOrEqual(
        1.5,
    );
}

for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
]) {
    test.describe(`the read view’s ingredient row at ${String(viewport.width)} px (curated U15, D1)`, () => {
        test.use({ viewport });

        test('a variant-bound line keeps its quantity and checkbox on the name’s line', async ({ page }) => {
            await seed(page);
            await page.goto(route(`/recipes/${RECIPE_ID}`));

            const variantRow = rowOf(
                page,
                '2 lb beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised',
            );

            await expect(variantRow).toBeVisible();
            const geometry = await measure(variantRow, {
                quantity: '2 lb',
                name: 'beef brisket',
                firstPart: 'flat half',
            });

            // Positive control: the dotted line sits on a line of its own under the name, so this row is two lines or
            // more, and a quantity centred on the whole row would sit below the name's line.
            expect(geometry.firstPart, 'the dotted line was laid out').not.toBeNull();
            expect(geometry.firstPart?.top ?? 0, 'the dotted line is under the name').toBeGreaterThanOrEqual(
                geometry.name?.bottom ?? Number.POSITIVE_INFINITY,
            );
            expectQuantityAndCheckboxOnTheNameLine(geometry);
        });

        test('a root-bound line, one line tall, measures the same way (the method’s control)', async ({ page }) => {
            await seed(page);
            await page.goto(route(`/recipes/${RECIPE_ID}`));

            const rootRow = rowOf(page, '1 lb beef brisket');

            await expect(rootRow).toBeVisible();
            expectQuantityAndCheckboxOnTheNameLine(await measure(rootRow, { quantity: '1 lb', name: 'beef brisket' }));
        });
    });
}
