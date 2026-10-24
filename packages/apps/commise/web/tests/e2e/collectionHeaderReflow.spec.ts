import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeCollection, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A long collection name is never squeezed into a column beside its actions (E3, WCAG 1.4.10).
 *
 * At 320 "Weeknight Dinners the Whole Family Will Actually Eat" rendered as "Wee / knig / ht / Dinn / ers …", nine
 * lines tall, because the name could shrink to one character beside the actions. The rule
 * (`specSharedSystem.md` §1, §6): on a narrow screen the name has the full row and the actions (Add recipes and the ⋯ menu,
 * slice 5) sit BELOW it. So this
 * asserts geometry in a real browser — the actions start under the name's last line, the name keeps most of the row,
 * and the page does not scroll sideways. jsdom has no layout to measure.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

const NAME = 'Weeknight Dinners the Whole Family Will Actually Eat';

for (const width of [320, 390] as const) {
    test(`a long collection name keeps the row and its actions sit below it at ${String(width)} px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            collections: [makeCollection({ id: 'col_long', ownerId: viewerId, name: NAME })],
        });

        await page.goto(route('/collections/col_long'));

        const name = page.getByRole('heading', { level: 1, name: NAME });
        const rename = page.getByRole('button', { name: 'Add recipes' }).first();
        await expect(name).toBeVisible();
        await expect(rename).toBeVisible();

        const nameBox = await name.boundingBox();
        const renameBox = await rename.boundingBox();
        expect(nameBox).not.toBeNull();
        expect(renameBox).not.toBeNull();
        // Below the name's last line, not beside it (one px of sub-pixel slack).
        expect(renameBox?.y ?? 0).toBeGreaterThanOrEqual((nameBox?.y ?? 0) + (nameBox?.height ?? 0) - 1);
        // The name keeps most of the row: a squeezed column was a few dozen px wide.
        expect(nameBox?.width ?? 0).toBeGreaterThanOrEqual(width * 0.6);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
}
