import { expect, type Page } from '@playwright/test';

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

/** The two footer actions' boxes and whether each label is one line (its box under 1.5 times its line height, qse C-4). */
export async function footerActions(page: Page) {
    const read = async (name: string) => {
        const button = sheetOf(page).getByRole('button', { name, exact: true });
        const box = await button.boundingBox();
        const label = await button.getByText(name, { exact: true }).evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        }));

        if (box === null) {
            throw new Error(`The ${name} action has no box.`);
        }

        return { box, oneLine: label.height < 1.5 * label.lineHeight };
    };

    return { dismiss: await read('Keep as draft'), confirm: await read('Publish') };
}
