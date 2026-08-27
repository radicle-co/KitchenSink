import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The create SpeedDial (U34, owner ruling 2026-08-25), through the real browser — real focus, real key
 * handling, real routing — with the recipe-service HTTP contract intercepted (`utils/recipeApi`).
 *
 * ## Why this spec exists, and why a component test is not enough
 *
 * The dial's whole risk is FOCUS, and focus is the one thing jsdom simulates rather than implements: the
 * trap, the restoration to the trigger on dismissal, and the fact that arrowing into the menu reaches a
 * control a keyboard user can actually activate are all browser behaviours. The component tier proves the
 * wiring; this tier proves it survives a real focus system and a real navigation.
 *
 * It also pins the accepted COST of this ruling end to end: the primary create path is now TWO presses, and
 * the second one is what navigates. A spec that only asserted the FAB opens something would pass against a
 * dial whose destination went nowhere — which is exactly the shape this ruling could have shipped.
 *
 * ⛔ Exactly ONE destination is asserted. Scan / Import / AI belong to features 004 and 005 and are not
 * rendered at all — promising a stopped feature is worse than omitting it.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
test.describe('create SpeedDial (U34)', () => {
    test('opens the dial and reaches the create wizard from its one destination', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [makeRecipeDetail({ id: 'rec_own', ownerId: viewerId, title: 'Weeknight Pasta' })],
        });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        const trigger = page.getByRole('button', { name: 'New recipe' });
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('menu', { name: 'Create a recipe' })).toHaveCount(0);

        await trigger.click();

        // ⛔ THE FLIP CONDITION FIRED, and this is the assertion it was waiting for (2026-08-27).
        //
        // This read `await expect(trigger).toHaveCount(0)` and carried a note that it was asserting a
        // DEVIATION rather than a property: `SpeedDial.tsx` adapted `@radix-ui/react-dialog`, whose modal
        // content calls `hideOthers(content)`, and the trigger lives OUTSIDE that content — so while the
        // dial was open the trigger was `aria-hidden` and `aria-expanded` was correct in the DOM and
        // unreachable to a screen reader. That note predicted its own replacement: "the day the flip
        // condition fires and this becomes `@radix-ui/react-dropdown-menu`, whose trigger stays exposed,
        // THIS assertion fails and points at the docstring that predicted it." It did, and it is.
        //
        // ⚠️ `modal={false}` is what earns the property — not the swap alone. `MenuRootContentModal` calls
        // the SAME `hideOthers`, and `DropdownMenu.Root`'s `modal` defaults to TRUE, so a naive swap would
        // have kept the deviation while looking like a fix. Verified in a real browser here, which is the
        // only place `aria-hidden` reachability can be checked at all.
        await expect(trigger).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        const menu = page.getByRole('menu', { name: 'Create a recipe' });
        await expect(menu).toBeVisible();
        // ONE destination, asserted as a count rather than as "the one I looked for is present" — the latter
        // passes just as well against a dial that also renders three dead ones.
        await expect(menu.getByRole('menuitem')).toHaveCount(1);
        // Opening alone must navigate NOWHERE: the second press is the one that creates.
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);

        await menu.getByRole('menuitem', { name: 'Create from Scratch' }).click();

        await expect(page).toHaveURL(/\/recipes\/new/);
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await expect(page.getByLabel('Title')).toBeVisible();
    });

    test('is fully operable from the keyboard, and Escape hands focus back to the FAB', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [makeRecipeDetail({ id: 'rec_own', ownerId: viewerId, title: 'Weeknight Pasta' })],
        });

        await page.goto(route('/recipes'));
        const trigger = page.getByRole('button', { name: 'New recipe' });
        await expect(trigger).toBeVisible();

        // ── ArrowDown opens onto the first destination ────────────────────────────────────────────────
        await trigger.focus();
        await page.keyboard.press('ArrowDown');

        const item = page.getByRole('menuitem', { name: 'Create from Scratch' });
        await expect(item).toBeFocused();

        // ── Escape closes AND restores focus ─────────────────────────────────────────────────────────
        // The failure this catches is silent in every other tier: a dial that dismisses correctly but drops
        // focus to `<body>` sends the viewer's next Tab back to the top of the document.
        await page.keyboard.press('Escape');

        await expect(page.getByRole('menu', { name: 'Create a recipe' })).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        // ── Enter on the focused destination navigates ───────────────────────────────────────────────
        await page.keyboard.press('Enter');
        await expect(item).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(page).toHaveURL(/\/recipes\/new/);
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
    });
});
