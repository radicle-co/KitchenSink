import { expect, test } from '@playwright/test';

import { footerActions, openStatementSheet, sheetOf } from './utils/statementSheet';

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
        await openStatementSheet(page, { width: 1280, height: 900, scale: 1 });

        const confirm = sheetOf(page).getByRole('button', { name: 'Publish', exact: true });
        const dismiss = sheetOf(page).getByRole('button', { name: 'Keep as draft', exact: true });
        const before = { confirm: await confirm.boundingBox(), dismiss: await dismiss.boundingBox() };

        // Stacked: Publish above Keep as draft, at one x.
        expect(before.confirm!.y).toBeLessThan(before.dismiss!.y);
        expect(before.confirm!.x).toBe(before.dismiss!.x);

        // A short window makes the body overflow the dialog, so its scrollbar arrives.
        await page.setViewportSize({ width: 1280, height: 420 });

        const overflows = await sheetOf(page).evaluate((dialog) =>
            [...dialog.querySelectorAll('*')].some(
                (element) =>
                    element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto',
            ),
        );

        expect(overflows).toBe(true);

        const after = { confirm: await confirm.boundingBox(), dismiss: await dismiss.boundingBox() };

        expect(after.confirm!.y).toBeLessThan(after.dismiss!.y);
        expect(after.confirm!.x).toBe(before.confirm!.x);
        expect(after.confirm!.width).toBe(before.confirm!.width);
        expect(after.dismiss!.x).toBe(before.dismiss!.x);
        expect(after.dismiss!.width).toBe(before.dismiss!.width);
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
});
