import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { role, roleDark } from '@commise/ui/colors';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * BOTH THEMES, IN A REAL BROWSER (`docs/design/uiOverhaul/ownerDecisions.md` D15; `darkTheme.md` §5–§6). The app
 * follows the system setting: Playwright's `colorScheme` is that setting. Each case reads COMPUTED colours off the
 * real page, so it proves the chain the unit tiers cannot see — the emitted dark block, Tailwind's role utilities
 * reading `var(--color-*)`, and the page canvas painted from the same variables.
 *
 * Expected values come from the token records themselves (`role`, `roleDark`), so a re-themed role moves the
 * expectation with it.
 */

const RECIPE_ID = 'rec_scheme';
const RECIPE_TITLE = 'Ember Roast Chicken';

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** A computed style property of an element. */
const computed = (locator: Locator, property: 'backgroundColor' | 'color'): Promise<string> =>
    locator.evaluate((element, name) => getComputedStyle(element)[name], property);

/** Sign in, seed one recipe the viewer owns, and open it. */
async function openRecipe(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [makeRecipeDetail({ id: RECIPE_ID, ownerId: viewerId, title: RECIPE_TITLE })],
    });

    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();
}

/** Open the viewer's recipe and its delete dialog. */
async function openDeleteDialog(page: Page): Promise<Locator> {
    await openRecipe(page);
    await page.getByRole('button', { name: /^More actions for /u }).click();
    await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'Delete recipe' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Delete this recipe?' });
    await expect(dialog).toBeVisible();

    return dialog;
}

const THEMES = [
    ['light', role],
    ['dark', roleDark],
] as const;

for (const [scheme, colors] of THEMES) {
    test.describe(`the ${scheme} theme`, () => {
        test.use({ colorScheme: scheme });

        test('paints the page canvas, the dialog surface and its controls from the scheme’s roles', async ({
            page,
        }) => {
            const dialog = await openDeleteDialog(page);

            expect(await computed(page.locator('body'), 'backgroundColor')).toBe(rgb(colors.canvas));
            expect(await computed(page.locator('body'), 'color')).toBe(rgb(colors.ink));
            expect(await computed(dialog, 'backgroundColor')).toBe(rgb(colors.paperOverlay));

            const keep = dialog.getByRole('button', { name: 'Keep recipe' });
            expect(await computed(keep, 'backgroundColor')).toBe(rgb(colors.paper));
            expect(await computed(keep, 'color')).toBe(rgb(colors.ink));

            const confirm = dialog.getByRole('button', { name: 'Delete recipe' });
            expect(await computed(confirm, 'backgroundColor')).toBe(rgb(colors.danger));
            expect(await computed(confirm, 'color')).toBe(rgb(colors.onAction));
        });

        test('paints the primary Edit action as the flat action fill', async ({ page }) => {
            await openRecipe(page);

            const edit = page.getByRole('link', { name: 'Edit recipe' });
            expect(await computed(edit, 'backgroundColor')).toBe(rgb(colors.action));
            expect(await computed(edit, 'color')).toBe(rgb(colors.onAction));
        });
    });
}
