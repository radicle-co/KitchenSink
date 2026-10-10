import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './basePath';

/**
 * The one-page recipe editor as a spec drives it (UI overhaul slice 7, build spec §7). ONE statement of the page's
 * structure for every spec that only needs to reach a field: the four sections share one page, so there is no step to
 * walk to, and a field is reached by its label. A spec ABOUT the editor (`recipeEditor.spec.ts`) asserts the structure
 * itself; this module only uses it.
 *
 * Selectors are role and label only (repo policy).
 */

/** The editor's sections, by their headings. */
export type EditorSectionName = 'Details' | 'Ingredients' | 'Steps' | 'Photos & publish';

/**
 * Open the editor on a new recipe, and wait for it.
 *
 * @param page - The signed-in page.
 */
export async function openNewRecipe(page: Page): Promise<void> {
    await page.goto(route('/recipes/new'));
    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
}

/**
 * Open the editor on a stored recipe, and wait for it.
 *
 * @param page - The signed-in page.
 * @param recipeId - The recipe to edit.
 */
export async function openRecipeEditor(page: Page, recipeId: string): Promise<void> {
    await page.goto(route(`/recipes/${recipeId}/edit`));
    await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
}

/**
 * One section of the editor: a region named by its heading.
 *
 * @param page - The page.
 * @param name - The section's heading.
 * @returns The section.
 */
export function editorSection(page: Page, name: EditorSectionName): Locator {
    return page.getByRole('region', { name, exact: true });
}

/**
 * Set prep and cook time in minutes. The minutes box carries anything past 59 into the hours.
 *
 * @param page - The page.
 * @param times - The minutes to enter; an absent one is left as it is.
 */
export async function fillTimes(
    page: Page,
    times: { readonly prepMinutes?: number; readonly cookMinutes?: number },
): Promise<void> {
    if (times.prepMinutes !== undefined) {
        await page.getByLabel('Prep time, minutes').fill(String(times.prepMinutes));
    }

    if (times.cookMinutes !== undefined) {
        await page.getByLabel('Cook time, minutes').fill(String(times.cookMinutes));
    }
}

/**
 * A step's text field. Its label is exactly "Step {n}"; the timer boxes beside it are "Step {n} timer, …".
 *
 * @param page - The page.
 * @param n - The step's number, from 1.
 * @returns The field.
 */
export function stepField(page: Page, n: number): Locator {
    return page.getByLabel(`Step ${n}`, { exact: true });
}

/**
 * Add a step at the end of the list and type its text.
 *
 * @param page - The page.
 * @param instruction - The step's text.
 */
export async function addStep(page: Page, instruction: string): Promise<void> {
    const steps = page.getByRole('textbox', { name: /^Step \d+$/u });
    const before = await steps.count();

    await page.getByRole('button', { name: 'Add step' }).click();
    await expect(steps).toHaveCount(before + 1);
    await stepField(page, before + 1).fill(instruction);
}

/**
 * Set a NEW recipe's servings. The Stepper has no text box: it starts at 1 and steps with its two buttons.
 *
 * @param page - The page, on a new recipe whose servings were not yet changed.
 * @param count - The servings wanted, 1 or more.
 */
export async function setServings(page: Page, count: number): Promise<void> {
    for (let serving = 1; serving < count; serving += 1) {
        await page.getByRole('button', { name: 'More servings' }).click();
    }

    await expect(page.getByRole('group', { name: 'Servings' })).toContainText(String(count));
}

/** The ids of the boxes that stick at the editor's top: the header, and below 960 px the section index's strip or bar. */
const TOP_CHROME_IDS = ['recipe-editor-header', 'recipe-editor-index-strip', 'recipe-editor-index-bar'] as const;

/**
 * The sticky chrome at the editor's top, as one band: from the header's top edge to the lowest bottom edge of the
 * header and the index box stuck under it. A box the width hides measures 0 and takes no part. Read by element id,
 * the ids `@commise/features-recipes`' `EDITOR_TOP_CHROME_IDS` names, because the header is not a landmark: it sits
 * inside `main`.
 *
 * @param page - The page.
 * @returns The band's box, in CSS px.
 */
export async function editorTopChrome(
    page: Page,
): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
    return page.evaluate((ids) => {
        const boxes = ids.flatMap((id) => {
            const node = document.getElementById(id);

            return node === null ? [] : [node.getBoundingClientRect()];
        });
        const header = boxes[0];
        const top = header?.top ?? 0;
        const bottom = Math.max(top, ...boxes.map((box) => box.bottom));

        return { x: header?.left ?? 0, y: top, width: header?.width ?? 0, height: bottom - top };
    }, TOP_CHROME_IDS);
}

/** The text, escaped for a `RegExp`. */
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * A read ingredient row's open control (build spec §7.5.1): one button named "Edit {amount} {food}", or "Edit {food}"
 * for a line that states no amount.
 *
 * @param scope - The page, or the section or list to look in.
 * @param food - The food the row names.
 * @returns The control.
 */
export function ingredientOpen(scope: Page | Locator, food: string): Locator {
    return scope.getByRole('button', { name: new RegExp(`^Edit (.+ )?${escaped(food)}$`, 'u') });
}

/**
 * A read ingredient row's list item, by the food it names.
 *
 * @param scope - The page, or the section or list to look in.
 * @param food - The food the row names.
 * @returns The row.
 */
export function ingredientRow(scope: Page | Locator, food: string): Locator {
    // A `has` locator is matched INSIDE each list item, so it is built from the page, never from `scope`: a locator
    // chained under `scope` would look for `scope` inside the item and find nothing.
    const page = 'page' in scope && typeof scope.page === 'function' ? (scope as Locator).page() : (scope as Page);

    return scope.getByRole('listitem').filter({ has: ingredientOpen(page, food) });
}

/**
 * Open a row's editor (build spec §7.5.2) and answer where its fields are: the phone sheet below a 600 container, or
 * the inline panel in the row from 600.
 *
 * @param page - The page.
 * @param food - The food the row names.
 * @returns The sheet or the row, holding Amount, Unit and Preparation.
 */
export async function openIngredientEditor(page: Page, food: string): Promise<Locator> {
    const row = ingredientRow(page, food);

    await ingredientOpen(page, food).click();
    await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();

    const sheet = page.getByRole('dialog', { name: food });

    return (await sheet.count()) > 0 ? sheet : row;
}

/**
 * Choose an item on a row's `⋯` (build spec §7.5.1).
 *
 * @param page - The page.
 * @param food - The food the row names, as its `⋯` is named ("Actions for {food}").
 * @param item - The menu item.
 */
export async function chooseRowAction(page: Page, food: string, item: string): Promise<void> {
    await page.getByRole('button', { name: `Actions for ${food}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
}
