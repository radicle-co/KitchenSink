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
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
    });

    test('the More menu discloses a DS-surfaced Version history link that opens the versions route', async ({
        page,
    }) => {
        await openOwnRecipe(page);

        // The secondary actions are behind the overflow trigger — which is itself a DS surface, not bare text.
        const more = page.getByRole('button', { name: 'More' });
        await expectDesignSystemSurface(more);
        // The trigger announces that it discloses a menu, and starts collapsed.
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('link', { name: 'Version history' })).toHaveCount(0);

        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');

        const versionHistory = page.getByRole('menu', { name: 'More' }).getByRole('link', { name: 'Version history' });
        await expectDesignSystemSurface(versionHistory);

        await versionHistory.click();

        await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/versions$`));
        await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
    });

    test('Delete confirms in an alertdialog, then deletes and returns to the recipes list', async ({ page }) => {
        await openOwnRecipe(page);

        await page.getByRole('button', { name: 'More' }).click();

        const deleteTrigger = page.getByRole('menu', { name: 'More' }).getByRole('button', { name: 'Delete recipe' });
        await expectDesignSystemSurface(deleteTrigger);
        // The trigger announces the dialog it opens — the reason it stays a plain `<button>` on the DS surface
        // rather than the DS `Button` component (which carries no popup hint).
        await expect(deleteTrigger).toHaveAttribute('aria-haspopup', 'dialog');

        await deleteTrigger.click();

        // A destructive action confirms in an ALERTDIALOG (not a plain dialog), and the confirmation NAMES the
        // recipe — an unnamed "are you sure?" is how the wrong recipe gets deleted.
        const dialog = page.getByRole('alertdialog', { name: 'Delete recipe' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(new RegExp(RECIPE_TITLE))).toBeVisible();

        // Both dialog controls are DS surfaces too (they were each re-typing their own pill before).
        await expectDesignSystemSurface(dialog.getByRole('button', { name: 'Cancel' }));
        const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
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
        await expect(page.getByRole('button', { name: 'Clone' })).toBeVisible();

        // Every owner control is ABSENT — not disabled, not hidden-but-clickable.
        await expect(page.getByRole('link', { name: 'Edit recipe' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Delete recipe' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Version history' })).toHaveCount(0);
    });
});
