import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe-detail OWNER ACTIONS — the `[Edit] [More]` header, its destructive confirmation, and the non-owner
 * gate — driven through the real web UI with the recipe/identity contract intercepted (`utils/recipeApi`).
 *
 * ## Why this spec exists (the regression it is built to catch)
 *
 * Every owner control on this surface once shipped with NO `className` at all: Edit, Version history and the
 * delete trigger rendered as bare elements — plain underlined text with no pill, no padding, no palette and no
 * touch floor. They *worked*: a component test that clicks by role and asserts the callback fired passes on a
 * completely unstyled control, and one did. Nothing in the suite could tell "a design-system button" from "a
 * word of text", so an effectively invisible header went out.
 *
 * So each owner control here is asserted on TWO axes:
 *  - it **does the right thing** (Edit → the editor; More → Version history → the versions route; Delete → an
 *    `alertdialog` that, on confirm, deletes and returns to the list); and
 *  - it **looks like a control**: a painted surface, pill geometry, real horizontal padding, and a height a
 *    line of text cannot reach. Those are read from COMPUTED style in the real browser, which is the only tier
 *    that can see them at all — jsdom computes no Tailwind. The bare-element regression fails every one of
 *    them (radius 0, padding 0, no paint), which is exactly the point.
 *
 * The two navigations are deliberately real links (⌘-click / open-in-new-tab / the `link` role), so they are
 * asserted as links, not buttons — a `<button onClick={router.push}>` "fix" would fail here.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
const RECIPE_ID = 'rec_owned';
const RECIPE_TITLE = 'Ember Roast Chicken';

/** The computed facts that distinguish a design-system control from bare text. */
interface ControlSurface {
    /** `border-top-left-radius` in px — 0 on an unstyled element, pill-sized on a DS surface. */
    readonly borderRadiusPx: number;
    /** `padding-left` in px — 0 on an unstyled element. */
    readonly paddingXPx: number;
    /** Whether the control paints anything of its own (a background colour or a gradient image). */
    readonly painted: boolean;
    /** Rendered height in px — a bare line of body text cannot reach a button's box. */
    readonly heightPx: number;
}

/**
 * Read the computed surface facts off a control in the real browser.
 *
 * @param locator - The control to measure.
 * @returns Its computed radius, horizontal padding, paint and height.
 */
async function readControlSurface(locator: Locator): Promise<ControlSurface> {
    return locator.evaluate((element) => {
        const style = getComputedStyle(element);
        const unpainted = new Set(['rgba(0, 0, 0, 0)', 'transparent']);

        return {
            borderRadiusPx: Number.parseFloat(style.borderTopLeftRadius),
            paddingXPx: Number.parseFloat(style.paddingLeft),
            painted: style.backgroundImage !== 'none' || !unpainted.has(style.backgroundColor),
            heightPx: element.getBoundingClientRect().height,
        };
    });
}

/**
 * Assert a control reads as a design-system button rather than as a run of text — the guard the bare-element
 * regression escaped through.
 *
 * @param locator - The control to check.
 */
async function expectDesignSystemSurface(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();

    const surface = await readControlSurface(locator);

    expect(surface.painted).toBe(true);
    // `rounded-full` — anything a pill could be. An unstyled element is 0.
    expect(surface.borderRadiusPx).toBeGreaterThanOrEqual(16);
    // `px-5` (20px). An unstyled element is 0.
    expect(surface.paddingXPx).toBeGreaterThanOrEqual(16);
    // `py-2.5` around body-sm text ≈ 40px; bare text on this surface is ~20px.
    expect(surface.heightPx).toBeGreaterThanOrEqual(36);
}

/** Sign in, seed ONE recipe owned by the live viewer, and land on its detail. */
async function openOwnRecipe(page: Page): Promise<void> {
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

test.describe('recipe-detail owner actions', () => {
    test('Edit is a real, DS-surfaced link into the editor', async ({ page }) => {
        await openOwnRecipe(page);

        // Edit is the sole PRIMARY owner control, outside the overflow menu, and a link (not a button).
        const edit = page.getByRole('link', { name: 'Edit recipe' });
        await expectDesignSystemSurface(edit);

        await edit.click();

        await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/edit$`));
        // The editor opened (not merely the URL): its task heading.
        await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
    });

    test('the ⋯ menu discloses Version history, which opens the versions route', async ({ page }) => {
        await openOwnRecipe(page);

        // The secondary actions are behind the overflow trigger: the `⋯` glyph, named for the recipe, a 44px target
        // (UI-overhaul slice 2; it used to be a "More" text pill).
        const more = page.getByRole('button', { name: `More actions for ${RECIPE_TITLE}` });
        await expect(more).toBeVisible();
        const target = await more.boundingBox();
        expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
        // The trigger announces that it discloses a menu, and starts collapsed.
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('menuitem', { name: 'Version history' })).toHaveCount(0);

        await more.click();
        // Open, the menu is modal: Radix hides the rest of the page (the trigger included) from the accessibility
        // tree, so the open state is asserted on the menu itself.
        await expect(page.getByRole('menu')).toBeVisible();

        // The menu is the design system's `ActionMenu`: a Radix menu of menu items (APG Menu Button).
        const versionHistory = page.getByRole('menu').getByRole('menuitem', { name: 'Version history' });
        await expect(versionHistory).toBeVisible();

        await versionHistory.click();

        await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/versions$`));
        await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
    });

    /**
     * Finding D2 (`docs/design/uiOverhaul/evaluateRecipeAndWizard.md`): at 390 px the menu opened UNDER the fixed bottom
     * tab bar, hiding most of "Delete recipe" (SC 2.4.11). Its whole box must now sit above the bar, even parked where a
     * placement that ignored the bar would overlap it.
     */
    test('at 390px the ⋯ panel opens clear of the bottom tab bar (D2)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 700 });
        await openOwnRecipe(page);

        const trigger = page.getByRole('button', { name: `More actions for ${RECIPE_TITLE}` });
        const panel = page.getByRole('menu');
        // The sidebar shares the name and is hidden below 840 px; the visible one is the tab bar.
        const bar = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });

        // Measure the panel once, then park the trigger where a panel placed BELOW it would still fit inside the
        // viewport but end under the bar. Only a panel that knows the bar's extent flips above from there: this is the
        // placement that made D2, and the one that proves the shell's insets reach the popup.
        await trigger.click();
        const panelHeight = (await panel.boundingBox())?.height ?? 0;
        await page.keyboard.press('Escape');
        const barTop = (await bar.boundingBox())?.y ?? 0;
        await trigger.evaluate((element, gap) => {
            const box = element.getBoundingClientRect();
            window.scrollBy(0, box.bottom - (window.innerHeight - gap));
        }, panelHeight + 24);

        await trigger.click();
        const deleteTrigger = panel.getByRole('menuitem', { name: 'Delete recipe' });
        await expect(deleteTrigger).toBeVisible();

        const box = await panel.boundingBox();

        expect(panelHeight, 'the panel was measured').toBeGreaterThan(0);
        expect(box, 'the panel is on screen').not.toBeNull();
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(barTop);
        // And nothing under the bar intercepts the press that reaches Delete.
        await deleteTrigger.click({ trial: true });
    });

    test('Delete confirms in an alertdialog, then deletes and returns to the recipes list', async ({ page }) => {
        await openOwnRecipe(page);

        await page.getByRole('button', { name: /^More actions for /u }).click();

        // Delete is the menu's one destructive action, last after a divider (`ActionMenu`, §1.11).
        const deleteTrigger = page.getByRole('menu').getByRole('menuitem', { name: 'Delete recipe' });
        await expect(deleteTrigger).toBeVisible();

        await deleteTrigger.click();

        // A destructive action confirms in an ALERTDIALOG (not a plain dialog), and the confirmation NAMES the
        // recipe — an unnamed "are you sure?" is how the wrong recipe gets deleted.
        const dialog = page.getByRole('alertdialog', { name: 'Delete this recipe?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(new RegExp(RECIPE_TITLE))).toBeVisible();

        // Both dialog controls are DS surfaces too (they were each re-typing their own pill before).
        // Verb buttons, focus on the safe one (spec §6.5): "Keep recipe" holds focus as the dialog opens.
        const keep = dialog.getByRole('button', { name: 'Keep recipe' });
        await expectDesignSystemSurface(keep);
        await expect(keep).toBeFocused();
        const confirm = dialog.getByRole('button', { name: 'Delete recipe' });
        await expectDesignSystemSurface(confirm);

        await confirm.click();

        // Confirming deletes and lands back on the recipes list — WITHOUT the recipe.
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(page.getByRole('button', { name: RECIPE_TITLE })).toHaveCount(0);
    });

    test('a NON-owner sees no owner actions at all', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // Someone else's PUBLIC recipe: readable by this viewer, owned by another account.
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: 'rec_theirs',
                    ownerId: 'usr_other',
                    title: 'Somebody Else’s Cassoulet',
                    visibility: 'public',
                }),
            ],
        });

        await page.goto(route('/recipes/rec_theirs'));
        await expect(page.getByRole('heading', { level: 1, name: 'Somebody Else’s Cassoulet' })).toBeVisible();

        // The NON-owner affordance IS present — so the absences below are a gate, not a page that failed to
        // render (which is how "no owner actions" assertions pass for the wrong reason).
        await expect(page.getByRole('button', { name: 'Save a copy' })).toBeVisible();

        // Every owner control is ABSENT — not disabled, not hidden-but-clickable.
        await expect(page.getByRole('link', { name: 'Edit recipe' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^More actions for /u })).toHaveCount(0);
        await expect(page.getByRole('menuitem', { name: 'Delete recipe' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Version history' })).toHaveCount(0);
    });
});
