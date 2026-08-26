/**
 * U32 — THE PINNED ACTION BAR, at real viewports in a real browser.
 *
 * ⛔ **This tier is not optional here, and the component tests say why.** jsdom loads no CSS, so
 * `Wizard.test.tsx` can only assert the CLASS contract (`fixed`, `bottom-0`, `env(safe-area-inset-bottom)`,
 * `lg:static`). Whether those classes actually keep the bar on screen after scrolling a 30-ingredient recipe
 * is a LAYOUT fact, and only a browser has layout. The shipped defect this unit fixes was exactly that kind
 * of fact: the primary control existed, was reachable by query, and was hundreds of pixels below the fold.
 *
 * The three viewport bands are the ones the owner ruling names:
 *  - **375px (phone)** — the bar is pinned to the bottom of the VIEWPORT, before and after a long scroll.
 *  - **768px (tablet)** — still pinned. ⚠️ This is the band the mockup's `md:hidden` bar does not exist in at
 *    all; adopting that breakpoint would have shipped the gap rather than closed it, so the assertion here is
 *    that 768 behaves like 375 and NOT like 1024.
 *  - **1024px (`lg`, desktop)** — the bar is in the sticky header band at the TOP, not floating at the bottom.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, makeRecipeDetail, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/** A recipe with enough ingredients that the step body is taller than any of the tested viewports. */
const THIRTY_INGREDIENT_RECIPE = makeRecipeDetail({
    id: 'rec_bar',
    title: 'Thirty-ingredient stew',
    ingredients: Array.from({ length: 30 }, (_unused, index) => ({
        ingredientId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: `Ingredient ${index + 1}`,
        quantity: { kind: 'exact' as const, value: 1 },
        unit: 'g',
        isUserEntered: false,
    })),
});

/**
 * The same long recipe with NO instructions — the only state in which step 3 can legitimately refuse.
 *
 * ⛔ This seed is the whole point of the refusal test below, and its absence is what made that test vacuous:
 * `makeRecipeDetail` defaults `steps` to one instruction, so the seed above is VALID on every step and
 * `Next: Review` simply advanced. The assertion then waited on an `alert` that correctly never appeared and
 * failed reading Next.js's empty route announcer — a test that could not have distinguished a working gate
 * from a deleted one. `steps: []` is preserved by the factory (`over.steps ?? …` — an empty array is not
 * nullish), so this recipe really does reach the wizard with an empty Instructions step.
 */
const NO_INSTRUCTIONS_RECIPE = makeRecipeDetail({
    id: 'rec_bar_no_steps',
    title: 'Stew with no method yet',
    ingredients: THIRTY_INGREDIENT_RECIPE.ingredients,
    steps: [],
});

/** Open the seeded recipe's edit wizard and land on the Ingredients step, where the long list lives. */
async function openIngredientsStep(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [THIRTY_INGREDIENT_RECIPE] });
    await page.goto(route('/recipes/rec_bar/edit'));

    await page.getByRole('button', { name: /Ingredients:/ }).click();
    await expect(page.getByRole('button', { name: 'Next: Instructions' })).toBeVisible();
}

/** Whether the control's box sits inside the viewport, i.e. a cook can reach it without scrolling. */
async function isOnScreen(page: Page, name: string): Promise<boolean> {
    const box = await page.getByRole('button', { name }).boundingBox();
    const viewport = page.viewportSize();

    if (box === null || viewport === null) {
        return false;
    }

    return box.y >= 0 && box.y + box.height <= viewport.height;
}

test.describe('recipe wizard action bar — 375px phone (U32)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('keeps Previous, Save Draft and Next on screen through a 30-ingredient list', async ({ page }) => {
        await openIngredientsStep(page);

        // Before any scrolling — the bar is already at the bottom of the viewport, not below the content.
        expect(await isOnScreen(page, 'Next: Instructions')).toBe(true);
        expect(await isOnScreen(page, 'Save Draft')).toBe(true);
        expect(await isOnScreen(page, 'Prev: Details')).toBe(true);

        // ⛔ THE SHIPPED DEFECT. Scroll to the very bottom of a list long enough to bury a control that
        // scrolled with it, then assert the bar has not moved with the page.
        await page.getByText('Ingredient 30').scrollIntoViewIfNeeded();

        expect(await isOnScreen(page, 'Next: Instructions')).toBe(true);
        expect(await isOnScreen(page, 'Save Draft')).toBe(true);
    });

    test('sits at the BOTTOM of the viewport, not in the header band', async ({ page }) => {
        await openIngredientsStep(page);

        const box = await page.getByRole('button', { name: 'Next: Instructions' }).boundingBox();
        const viewport = page.viewportSize();

        expect(box).not.toBeNull();
        expect(viewport).not.toBeNull();
        // Within the bottom third — a bar merely "on screen" could still be a header row.
        expect(box?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.66);
    });

    test('offers exactly ONE of each action control, so no name is ambiguous', async ({ page }) => {
        // The regression a two-copies-hidden-per-breakpoint layout would introduce, asserted where a real
        // browser can see `display: none` — which is precisely what jsdom cannot.
        await openIngredientsStep(page);

        await expect(page.getByRole('button', { name: 'Save Draft' })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Next: Instructions' })).toHaveCount(1);
    });

    test('replaces the kebab with a back arrow that routes through the discard guard', async ({ page }) => {
        await openIngredientsStep(page);

        // Below `lg` the overflow menu is gone: Save Draft is in the bar, Cancel is the arrow.
        await expect(page.getByRole('button', { name: 'More actions' })).toBeHidden();
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

        // Make an edit so there is something to lose, then confirm the arrow asks rather than leaving.
        await page.getByRole('button', { name: /Details:/ }).click();
        await page.getByLabel('Title').fill('Thirty-ingredient stew, revised');
        await page.getByRole('button', { name: 'Back' }).click();

        await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
    });
});

test.describe('recipe wizard action bar — 768px tablet, the band the mockup omits (U32)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('is PINNED here too — 768 behaves like 375, not like 1024', async ({ page }) => {
        // ⚠️ The mockup's bar is `md:hidden`, so at this width it does not exist at all and the tablet falls
        // back to a desktop header row it was never laid out for. The ruling is `lg`, not `md`; this test is
        // what makes that a checked property rather than a comment.
        await openIngredientsStep(page);

        const box = await page.getByRole('button', { name: 'Next: Instructions' }).boundingBox();
        const viewport = page.viewportSize();

        expect(box?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.66);
        await expect(page.getByRole('button', { name: 'Save Draft' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    });
});

test.describe('recipe wizard action bar — 1024px desktop (U32)', () => {
    test.use({ viewport: { width: 1024, height: 800 } });

    test('moves into the sticky header band at `lg`, and the kebab returns with it', async ({ page }) => {
        await openIngredientsStep(page);

        const box = await page.getByRole('button', { name: 'Next: Instructions' }).boundingBox();
        const viewport = page.viewportSize();

        // Top third — the header row, not a floating bar.
        expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan((viewport?.height ?? 0) * 0.33);

        // The back arrow is the below-`lg` affordance; at `lg` the overflow menu carries Cancel again.
        await expect(page.getByRole('button', { name: 'Back' })).toBeHidden();
        await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
    });

    test('discloses Cancel from the kebab, and NOT a second Save Draft', async ({ page }) => {
        // ⛔ The ruling reads two ways at `lg` and only one can hold: the bar carries Save Draft at every
        // width, so putting it in the menu too would name two controls the same thing on one surface — the
        // duplicate-accessible-name failure this whole layout was shaped to avoid.
        await openIngredientsStep(page);
        await page.getByRole('button', { name: 'More actions' }).click();

        const menu = page.getByRole('menu', { name: 'More actions' });

        await expect(menu.getByRole('menuitem', { name: 'Cancel' })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Save Draft' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Save Draft' })).toHaveCount(1);
    });

    test('still refuses an invalid Next, and still says why', async ({ page }) => {
        // The shipped `canAdvanceFromStep` gate and its voiced refusal must survive the re-layout — the
        // mockup's own `goNext` advances unconditionally into an empty form.
        //
        // ⚠️ REWRITTEN (this run): the seed is now `NO_INSTRUCTIONS_RECIPE`, and the assertions prove
        // BOTH halves of the gate rather than one vague substring. What changed and why:
        //  - it drives a recipe whose Instructions step is genuinely empty, so `Next` has something to refuse;
        //  - it asserts the wizard STAYED on step 3, which is the refusal itself — voicing a message while
        //    advancing anyway would have passed the old assertion;
        //  - it asserts the EXACT sentence `stepsRequired` carries, not `toContainText('step')`, which the
        //    word "step" in "Step 3 of 4" alone could have satisfied;
        //  - it scopes to that sentence, because an unscoped `getByRole('alert')` also matches Next's
        //    `__next-route-announcer__` and would be a strict-mode violation the moment the notice renders.
        //  - it asserts the rail marker flipped to `needs attention`, the other half of the same refusal.
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [NO_INSTRUCTIONS_RECIPE] });
        await page.goto(route('/recipes/rec_bar_no_steps/edit'));

        await page.getByRole('button', { name: /Instructions:/ }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();

        await page.getByRole('button', { name: 'Next: Review' }).click();

        await expect(page.getByRole('alert').filter({ hasText: 'Add at least one instruction step.' })).toBeVisible();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await expect(page.getByRole('button', { name: /Instructions: needs attention/ })).toBeVisible();
    });
});
