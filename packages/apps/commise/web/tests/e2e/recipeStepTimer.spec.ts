import { expect, test, type Page } from '@playwright/test';

import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor, stepField } from './utils/recipeEditor';
import { signInWithTicket } from './utils/auth';

/**
 * The recipe editor's Steps section: the instruction field has room at 320 px, and a step's timer is entered and read in
 * hours and minutes (`docs/design/uiOverhaul/evaluateRecipeAndWizard.md` I1 and F1).
 *
 * - I1: at 320 the instruction field shared one line with the step number, a 112 px timer box and Remove, and was
 *   squeezed to about 12 px, so a step could not be read or typed. The field now has its line to itself. jsdom has no
 *   layout, so only a browser can measure it.
 * - F1: the timer took seconds ("16200") and the recipe showed "16200s timer". A cook now types 4 h 30 min and the
 *   recipe reads "4 h 30 min", end to end through the save.
 *
 * REWRITTEN for slice 7: the step field is named "Step {n}", a timer is added from the step's "Add a timer", and the
 * seed is published, so the save is Save changes (D1).
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** Open the seeded recipe's editor, with its first step's field on the page. */
async function openSteps(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, tier: 'premium' });

    await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');
    await expect(stepField(page, 1)).toBeVisible();
}

test('a step`s instruction field has its line to itself at 320 px', async ({ page }) => {
    await openSteps(page);
    await page.setViewportSize({ width: 320, height: 800 });

    const field = stepField(page, 1);
    const row = page.getByRole('listitem').filter({ has: field });
    const fieldBox = await field.boundingBox();
    const rowBox = await row.boundingBox();

    expect(fieldBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(fieldBox?.width ?? 0).toBeGreaterThanOrEqual((rowBox?.width ?? 0) - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('a step timer is entered in hours and minutes and the recipe reads it that way', async ({ page }) => {
    await openSteps(page);

    await page
        .getByRole('listitem')
        .filter({ has: stepField(page, 1) })
        .getByRole('button', { name: 'Add a timer' })
        .click();
    await page.getByRole('spinbutton', { name: 'Step 1 timer, hours' }).fill('4');
    await page.getByRole('spinbutton', { name: 'Step 1 timer, minutes' }).fill('30');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(/\/recipes\/ec000000-0000-4000-8000-00000000002c(?:\?|$)/);
    await expect(page.getByText('4 h 30 min')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Timer' })).toBeVisible();
    await expect(page.getByText(/16200/)).toHaveCount(0);
});
