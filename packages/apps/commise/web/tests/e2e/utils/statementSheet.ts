import { expect, type Locator, type Page } from '@playwright/test';

import { signInWithTicket } from './auth';
import { mockFoodApi } from './foodApi';
import { mockRecipeApi, readViewerAppId } from './recipeApi';
import { chooseCuisine, openNewRecipe } from './recipeEditor';
import { applyTextScale } from './textScale';

/** The "Where is this recipe from?" dialog. */
export const sheetOf = (page: Page) => page.getByRole('dialog', { name: 'Where is this recipe from?' });

/**
 * A new editor recipe with one pasted step, its Publish pressed at `width` x `height` and text `scale`, so the statement
 * sheet is open. The recipe-service contract is intercepted, as in `recipeSourceFromPaste.spec.ts`.
 */
export async function openStatementSheet(
    page: Page,
    view: {
        readonly width: number;
        readonly height: number;
        readonly scale: number;
        readonly overlayScrollbars?: boolean;
    },
): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
    await mockFoodApi(page);
    await page.setViewportSize({ width: view.width, height: view.height });
    await openNewRecipe(page);
    await page.getByLabel('Title').fill('E2E Statement Sheet');
    await chooseCuisine(page);
    await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
    await page.getByRole('group', { name: 'Food catalog' }).getByRole('option', { name: 'Salt', exact: true }).click();
    await page.getByRole('button', { name: 'Paste steps' }).click();
    await page.getByRole('textbox', { name: 'Steps', exact: true }).fill('Simmer the stock.');
    await page.getByRole('button', { name: 'Add 1 step' }).click();

    if (view.overlayScrollbars === true) {
        // Playwright's Chromium draws classic scrollbars, so an overlay one is simulated: with no scrollbar to draw, a
        // `scrollbar-gutter: stable` region reserves nothing, as it does under an overlay scrollbar.
        await page.addStyleTag({ content: '* { scrollbar-width: none; }' });
    }

    await applyTextScale(page, view.scale);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(sheetOf(page)).toBeVisible();
}

/**
 * The box of a control that must be on screen. A hidden or detached control fails with its name, not with a bare
 * `Cannot read properties of null`.
 */
export async function boxOf(locator: Locator, name: string) {
    const box = await locator.boundingBox();

    if (box === null) {
        throw new Error(`The ${name} has no box.`);
    }

    return box;
}

/**
 * The two footer actions' boxes, the width of the actions' row, and whether each label is one line (the label's own text
 * box under 1.5 times its line height, qse C-4). Measured from the button found by role: no text locator.
 */
export async function footerActions(page: Page) {
    const read = async (name: string) => {
        const button = sheetOf(page).getByRole('button', { name, exact: true });
        const box = await boxOf(button, `${name} action`);
        const label = await button.evaluate((element) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const range = document.createRange();

            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                if ((node.textContent ?? '').trim() !== '') {
                    range.selectNodeContents(node);

                    return {
                        height: range.getBoundingClientRect().height,
                        lineHeight: Number.parseFloat(getComputedStyle(node.parentElement ?? element).lineHeight),
                        rowWidth: element.closest('[data-dialog-actions]')?.getBoundingClientRect().width ?? 0,
                    };
                }
            }

            throw new Error('The action has no text.');
        });

        return { box, oneLine: label.height < 1.5 * label.lineHeight, rowWidth: label.rowWidth };
    };

    return { dismiss: await read('Keep as draft'), confirm: await read('Publish') };
}
