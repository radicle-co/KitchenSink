import { expect, test } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { SHEET_EDITOR_VIEWPORT, openIngredientEditor, openRecipeEditor } from './utils/recipeEditor';

import { boxOf, footerActions, openStatementSheet, sheetOf } from './utils/statementSheet';

// Chromium headless hides classic scrollbars by default; this file shows them, which is the whole point of it. It is its
// own spec because `launchOptions` is a file-top-level option and would otherwise change every test beside it.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/**
 * Classic scrollbars never flip the statement sheet's actions (designer D11, plan KTD8). The sheet's scroll region reserves
 * its scrollbar gutter while it holds the `DialogActions` row, so a scrollbar that arrives when the body overflows does not
 * change the row's width. The 448 px dialog's row box is then 385 px at every text size, under the 400 threshold: the actions
 * are stacked before the body overflows and after, with the same x and width. Selectors are role and label only.
 */
test.describe('the statement sheet actions with classic scrollbars shown', () => {
    test('stacked before and after the body overflows, with the same x and width', async ({ page }) => {
        await openStatementSheet(page, { width: 1280, height: 1600, scale: 1 });

        const confirm = sheetOf(page).getByRole('button', { name: 'Publish', exact: true });
        const dismiss = sheetOf(page).getByRole('button', { name: 'Keep as draft', exact: true });
        const before = {
            confirm: await boxOf(confirm, 'Publish action'),
            dismiss: await boxOf(dismiss, 'Keep as draft action'),
        };

        // Stacked: Publish above Keep as draft, at one x.
        expect(before.confirm.y).toBeLessThan(before.dismiss.y);
        expect(before.confirm.x).toBe(before.dismiss.x);

        const overflowsNow = () =>
            sheetOf(page).evaluate((dialog) =>
                [...dialog.querySelectorAll('*')].some(
                    (element) =>
                        element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto',
                ),
            );

        // The body fits before the resize, so the scrollbar is not there yet.
        expect(await overflowsNow()).toBe(false);

        // A short window makes the body overflow the dialog, so its scrollbar arrives.
        await page.setViewportSize({ width: 1280, height: 420 });

        expect(await overflowsNow()).toBe(true);

        const after = {
            confirm: await boxOf(confirm, 'Publish action'),
            dismiss: await boxOf(dismiss, 'Keep as draft action'),
        };

        expect(after.confirm.y).toBeLessThan(after.dismiss.y);
        expect(after.confirm.x).toBe(before.confirm.x);
        expect(after.confirm.width).toBe(before.confirm.width);
        expect(after.dismiss.x).toBe(before.dismiss.x);
        expect(after.dismiss.width).toBe(before.dismiss.width);
    });

    // This build's Chromium draws classic scrollbars whatever the launch flags, so the 448 px dialog's row box is 385 px at
    // 100 percent and 785 px at 200 (the gutter is reserved), under 25 rem each time: the AE12 classic result.
    for (const scale of [1, 2] as const) {
        test(`AE11b and AE12 (classic): at 1280 px and ${String(scale * 100)} percent text the actions stack, Publish on top, one line each`, async ({
            page,
        }) => {
            await openStatementSheet(page, { width: 1280, height: 900, scale });
            const { dismiss, confirm } = await footerActions(page);

            expect(confirm.box.y + confirm.box.height).toBeLessThanOrEqual(dismiss.box.y);
            expect(confirm.box.x).toBe(dismiss.box.x);
            expect(confirm.box.width).toBe(dismiss.box.width);
            expect(dismiss.oneLine).toBe(true);
            expect(confirm.oneLine).toBe(true);
        });
    }

    // Overlay scrollbars are SIMULATED (`scrollbar-width: none` leaves the reserved gutter empty): Playwright's Chromium
    // draws classic ones. The 400 px row box is whole, so the actions sit side by side in equal shares (AE12).
    for (const scale of [1, 2] as const) {
        test(`AE11b and AE12 (overlay, simulated): at 1280 px and ${String(scale * 100)} percent text the actions sit side by side in equal shares, one line each`, async ({
            page,
        }) => {
            await openStatementSheet(page, { width: 1280, height: 900, scale, overlayScrollbars: true });
            const { dismiss, confirm } = await footerActions(page);

            expect(dismiss.box.x).toBeLessThan(confirm.box.x);
            expect(Math.abs(dismiss.box.y - confirm.box.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(dismiss.box.width - confirm.box.width)).toBeLessThanOrEqual(1);
            expect(dismiss.oneLine).toBe(true);
            expect(confirm.oneLine).toBe(true);
        });
    }

    // R9 (redteam 2): the ingredient line editor is the house sheet, `max-w-lg` 512 px, so its row box is 449 px with the
    // gutter reserved and stays side by side under CLASSIC scrollbars, as on main.
    test('the ingredient line editor keeps Cancel and Done side by side at 1280 px', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const garlic: RecipeDetail['ingredients'][number] = {
            ingredientId: '99999999-9999-4999-8999-999999999992',
            foodId: 'food_garlic',
            name: 'Garlic',
            quantity: { kind: 'exact', value: 2 },
            unit: 'clove',
            isUserEntered: false,
            resolutionStatus: 'RESOLVED',
        };
        const recipeId = 'ec000000-0000-4000-8000-000000000028';

        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: recipeId,
                    ownerId: viewerId,
                    title: 'Garlic supper',
                    cuisine: 'Italian',
                    status: 'draft',
                    currentVersion: 1,
                    ingredients: [garlic],
                }),
            ],
        });
        await mockFoodApi(page);
        await page.setViewportSize(SHEET_EDITOR_VIEWPORT);
        await openRecipeEditor(page, recipeId);
        const sheet = await openIngredientEditor(page, 'Garlic');
        const cancel = await boxOf(sheet.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel action');
        const done = await boxOf(sheet.getByRole('button', { name: 'Done', exact: true }), 'Done action');

        expect(cancel.x).toBeLessThan(done.x);
        expect(Math.abs(cancel.y - done.y)).toBeLessThanOrEqual(1);
    });
});
