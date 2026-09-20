/**
 * ⛔ UNSAVED RECIPE WORK MUST NOT BE LOST WITHOUT A PROMPT — the web half of a cross-platform data-loss fix.
 *
 * The defect was found on mobile (Android's hardware back button popped the recipe wizard with no
 * confirmation, on create as well as edit; the mobile half is `.maestro/recipes/systemBackGuard.yaml`). The
 * owner's requirement is that BOTH platforms prompt, each following its own platform-standard pattern. On web
 * that is two mechanisms, and this spec covers both:
 *
 *   1. the in-app discard dialog for an exit the wizard itself owns;
 *   2. the browser's own `beforeunload` prompt for a tab close or reload.
 *
 * **Viewports are PINNED, never inferred.** U32 gives the wizard two different exit affordances by width — the
 * back arrow below `lg`, the overflow menu's Cancel at `lg` and above (`recipeWizardActionBar.spec.ts` owns
 * that cutover) — so a spec that branched on which control happened to be visible would pass without telling
 * anyone which path it exercised. Both are driven here, each at its own width.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT ASSERTED. There is no spec for "browser back is blocked", because it is not —
 * the Next.js App Router exposes no supported navigation blocker and `popstate` cannot be cancelled. That is a
 * recorded decision (see `useUnloadGuard`'s module doc), not an oversight, and testing it would mean testing a
 * history-sentinel hack that was rejected as a worse defect than the one it patches. Nor is the unload
 * prompt's TEXT asserted: browsers have ignored page-supplied copy since 2016, so "the listener is armed" is
 * the whole of what `beforeunload` guarantees and the whole of what is claimed.
 */

import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/** Sign in and put the recipe contract behind a controlled in-memory store. */
async function signInWithMockedApi(page: Page) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, tier: 'premium' });

    return viewerId;
}

/** Open the create wizard at step 1, waiting for the rail so the assertions run against a hydrated tree. */
async function openCreateWizard(page: Page) {
    await page.goto(route('/recipes/new'));
    // Rail-scoped (not `getByText`) for the reason `recipeEditWizard.spec.ts` documents: a direct `goto` can
    // briefly hold both the server-rendered wizard and its hydrated replacement, and only the accessibility
    // tree hides the stale copy.
    await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 1 of 4');
}

test.describe('unsaved changes — the wizard’s own exit below `lg` (the back arrow)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('confirms before discarding, and Keep editing preserves what was typed', async ({ page }) => {
        await signInWithMockedApi(page);
        await openCreateWizard(page);

        await page.getByLabel('Title').fill('E2E Unsaved Draft');
        await page.getByRole('button', { name: 'Back' }).click();

        await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();

        await page.getByRole('button', { name: 'Keep editing' }).click();

        // BOTH halves. Asserting only that the dialog closed would pass against a guard that discarded the
        // work behind it.
        await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeHidden();
        await expect(page.getByLabel('Title')).toHaveValue('E2E Unsaved Draft');
    });

    test('leaves the wizard only once the discard is confirmed', async ({ page }) => {
        await signInWithMockedApi(page);
        await openCreateWizard(page);

        await page.getByLabel('Title').fill('E2E Discarded Draft');
        await page.getByRole('button', { name: 'Back' }).click();
        await page.getByRole('button', { name: 'Discard changes' }).click();

        await expect(page.getByLabel('Title')).toBeHidden();
    });

    test('a CLEAN wizard leaves immediately — a guard that always prompts is a nuisance, not a guard', async ({
        page,
    }) => {
        await signInWithMockedApi(page);
        await openCreateWizard(page);

        await page.getByRole('button', { name: 'Back' }).click();

        await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeHidden();
        await expect(page.getByLabel('Title')).toBeHidden();
    });
});

test.describe('unsaved changes — the wizard’s own exit at `lg` (the overflow menu’s Cancel)', () => {
    test.use({ viewport: { width: 1024, height: 800 } });

    test('Cancel from the kebab asks before discarding at desktop width too', async ({ page }) => {
        // The same guard reached by the OTHER affordance. U32 swaps the control at `lg`, so covering only one
        // width would leave half the users' exit path unproven.
        await signInWithMockedApi(page);
        await openCreateWizard(page);

        await page.getByLabel('Title').fill('E2E Desktop Draft');
        await page.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('menu', { name: 'More actions' }).getByRole('menuitem', { name: 'Cancel' }).click();

        await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();

        await page.getByRole('button', { name: 'Keep editing' }).click();

        await expect(page.getByLabel('Title')).toHaveValue('E2E Desktop Draft');
    });
});

test.describe('unsaved changes — the browser’s own unload prompt', () => {
    test('⛔ closing the tab on a DIRTY draft raises it', async ({ page }) => {
        await signInWithMockedApi(page);
        await openCreateWizard(page);
        await page.getByLabel('Title').fill('E2E Unload Guard');

        // `page.close({ runBeforeUnload: true })` is the ONLY way Playwright surfaces a `beforeunload` dialog
        // — a normal `close()` suppresses it. The listener must be armed BEFORE the close, and the dialog must
        // be handled or the page never finishes closing.
        const dialog = page.waitForEvent('dialog');
        await page.close({ runBeforeUnload: true });
        const raised = await dialog;

        expect(raised.type()).toBe('beforeunload');
        await raised.dismiss();
    });

    test('closing the tab on a CLEAN editor raises NO prompt', async ({ page }) => {
        // ⛔ THE FALSIFYING HALF, AND ITS TIMING IS THE POINT. A bare `expect(sawDialog).toBe(false)` after the
        // close reads the flag before the event could ever have arrived, so it passes whether or not the guard
        // is wrongly armed — the mutation-lens failure. Waiting for a dialog that must NOT come, and treating
        // the timeout as the pass, is the only form of this check that can fail.
        // Seeded inline rather than through the helper: the recipe must be owned by THIS viewer for the edit
        // route to render it at all, and the viewer id is only known after sign-in.
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [makeRecipeDetail({ id: 'rec_clean', ownerId: viewerId, title: 'Untouched Recipe' })],
        });

        await page.goto(route('/recipes/rec_clean/edit'));
        await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 1 of 4');

        const sawDialog = page
            .waitForEvent('dialog', { timeout: 3_000 })
            .then(async (dialog) => {
                await dialog.dismiss();

                return true;
            })
            .catch(() => false);

        await page.close({ runBeforeUnload: true });

        expect(await sawDialog).toBe(false);
    });
});
