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
 * ⛔ THE WHOLE DESTINATION LIST IS ASSERTED, in order, and it is TWO entries — not one.
 *
 * ⚠️ REWRITTEN (2026-09-03). This asserted `toHaveCount(1)` and had failed on every run of this branch
 * since plan U9 landed, because U9 made good on the shape U34 was BUILT for: "Paste an Ingredient List"
 * is the second destination, and it cost one list entry rather than a redesign (`RecipeList.tsx`'s own
 * comment says so, and `parseIngredients.spec.ts` reaches the paste surface through it). A count of one
 * was therefore a claim about a product that no longer exists — and the fix is not to relax the count but
 * to name what is there: the exact labels, in the exact order, which is strictly stronger than any count
 * and fails on an added entry, a removed one, a renamed one, AND on the primary path being demoted out of
 * first position. Scan / Import / AI still belong to features 004 and 005 and are still not rendered at
 * all — promising a stopped feature is worse than omitting it, and this assertion is what keeps that true.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
test.describe('create SpeedDial (U34)', () => {
    test('opens the dial, discloses both destinations, and reaches the create wizard', async ({ page }) => {
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
        // The WHOLE list, in order — not "the one I looked for is present", which passes just as well
        // against a dial that also renders three dead ones. `Create from Scratch` staying FIRST is part of
        // the assertion: U34's ruling is that adding a destination must not move the primary path.
        await expect(menu.getByRole('menuitem')).toHaveText(['Create from Scratch', 'Paste an Ingredient List']);
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
