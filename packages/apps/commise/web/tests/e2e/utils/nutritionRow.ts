import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** The nutrition section's accessible name on the recipe page. */
export const NUTRITION_REGION = 'Nutrition (per serving)';

/**
 * Open the recipe page's collapsed Nutrition row (`nativeBoards/buildLists.md` item 12) and return its region. The row
 * is a disclosure button, so its figures and caveats exist only once it is open.
 *
 * @sideEffect Presses the row's button.
 * @param page - A page on a recipe detail.
 * @returns The nutrition region, open.
 */
export async function openNutritionRow(page: Page): Promise<Locator> {
    const region = page.getByRole('region', { name: NUTRITION_REGION });
    const row = region.getByRole('button', { name: /^Nutrition/u });

    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');

    return region;
}
