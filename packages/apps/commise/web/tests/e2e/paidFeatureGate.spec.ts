import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The paid-features gate on every paid surface, in every state (plan 2026-10-14-009 D14; owner ruling 2026-10-13: "If
 * the user is NOT admin, NOT superuser, NOT vip, NOT premium and the gate flag is false, no paid feature is accessible
 * and no upsell button is visible").
 *
 * Driven through the real web UI with the recipe-service contract and `/api/v1/users/me` intercepted
 * (`utils/recipeApi`), because the state under test is identity's `account.paidFeatures`, which a deployed sandbox
 * answers with whatever its gate is set to — `paidFeatureRoles.spec.ts` covers the real roles against the real
 * service. Role/label selectors only.
 */
async function openEditorAs(page: Page, paidFeatures: 'granted' | 'upsell' | 'hidden'): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, paidFeatures });
    await page.goto(route('/recipes/new'));
    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
}

test.describe('paid features — the editor’s “Who can see it”', () => {
    test('granted: Private is a choice, with no Premium badge and no sheet', async ({ page }) => {
        await openEditorAs(page, 'granted');

        await page.getByRole('radio', { name: 'Private' }).check();

        await expect(page.getByRole('radio', { name: 'Private' })).toBeChecked();
        await expect(page.getByText('Premium', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Private recipes are part of Premium.' })).toHaveCount(0);
    });

    test('upsell: Private carries the Premium badge and opens the Premium sheet; Public stays chosen', async ({
        page,
    }) => {
        await openEditorAs(page, 'upsell');

        await expect(page.getByText('Premium', { exact: true })).toBeVisible();
        await page.getByRole('radio', { name: 'Private' }).click();

        await expect(page.getByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeVisible();
        await page.getByRole('button', { name: 'Not now' }).click();
        await expect(page.getByRole('radio', { name: 'Public' })).toBeChecked();
    });

    test('⛔ hidden: says “Who can see it: Public”, with no Private, no Premium and no upsell', async ({ page }) => {
        await openEditorAs(page, 'hidden');

        await expect(page.getByText('Who can see it')).toBeVisible();
        await expect(page.getByText('Anyone can find it in Discover')).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Private' })).toHaveCount(0);
        await expect(page.getByRole('radio', { name: 'Public' })).toHaveCount(0);
        await expect(page.getByText('Premium', { exact: true })).toHaveCount(0);
    });
});

test.describe('paid features — the recipe page’s ⋯ menu', () => {
    async function openOwnRecipe(page: Page, paidFeatures: 'granted' | 'upsell' | 'hidden'): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const own = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-0000000000f1',
            ownerId: viewerId,
            title: 'Gate Stew',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, paidFeatures, recipes: [own] });
        await page.goto(route('/recipes/ec000000-0000-4000-8000-0000000000f1'));
        await expect(page.getByRole('heading', { name: 'Gate Stew' })).toBeVisible();
        await page.getByRole('button', { name: /^More actions for /u }).click();
    }

    test('granted: Make private makes the recipe private', async ({ page }) => {
        await openOwnRecipe(page, 'granted');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByText('Private', { exact: true })).toBeVisible();
    });

    test('upsell: Make private opens the Premium sheet', async ({ page }) => {
        await openOwnRecipe(page, 'upsell');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeVisible();
    });

    test('⛔ hidden: the menu offers no Make private', async ({ page }) => {
        await openOwnRecipe(page, 'hidden');

        await expect(page.getByRole('menuitem', { name: 'Version history' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Make private' })).toHaveCount(0);
    });
});

test.describe('paid features — a collection’s ⋯ menu', () => {
    async function openOwnCollection(page: Page, paidFeatures: 'granted' | 'upsell' | 'hidden'): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures,
            collections: [
                makeCollection({ id: 'col_gate', ownerId: viewerId, name: 'Gate dinners', visibility: 'public' }),
            ],
        });
        await page.goto(route('/collections/col_gate'));
        await page.getByRole('button', { name: 'More actions for Gate dinners' }).click();
    }

    test('granted: Make private applies at once, with Undo', async ({ page }) => {
        await openOwnCollection(page, 'granted');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByText('Collection is now private.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    });

    test('upsell: Make private opens the Premium sheet', async ({ page }) => {
        await openOwnCollection(page, 'upsell');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByRole('dialog', { name: 'Private collections are part of Premium.' })).toBeVisible();
    });

    test('⛔ hidden: the menu offers no Make private', async ({ page }) => {
        await openOwnCollection(page, 'hidden');

        await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Make private' })).toHaveCount(0);
    });
});

/**
 * Plan 2026-10-14-009 Q5 (UX SPECIFY 2026-10-15): a downgraded owner — paid features hidden, or the upsell — who makes
 * a private recipe public cannot simply make it private again, so the step is confirmed first and says what it costs.
 * Once confirmed in the editor, the recipe is not offered Private again (the stuck-save defect).
 */
test.describe('paid features — a downgraded owner making a private recipe public', () => {
    const PRIVATE_ID = 'ec000000-0000-4000-8000-0000000000f2';

    async function openPrivateRecipe(page: Page, paidFeatures: 'upsell' | 'hidden', path: string): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const own = makeRecipeDetail({
            id: PRIVATE_ID,
            ownerId: viewerId,
            title: 'Secret Stew',
            visibility: 'private',
        });
        await mockRecipeApi(page, { viewerId, paidFeatures, recipes: [own] });
        await page.goto(route(path));
    }

    test('⛔ hidden, in the editor: Public asks first; confirmed, Private is not offered again', async ({ page }) => {
        await openPrivateRecipe(page, 'hidden', `/recipes/${PRIVATE_ID}/edit`);
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
        await expect(page.getByText("You won't be able to make it private again.")).toBeVisible();

        await page.getByRole('radio', { name: /^Public/u }).click();

        const dialog = page.getByRole('alertdialog', { name: 'Make this recipe public?' });
        await expect(dialog).toBeVisible();
        await expect(
            dialog.getByText(
                "Anyone can see a public recipe and save a copy. You won't be able to make this one private again.",
            ),
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Keep private' })).toBeFocused();
        await dialog.getByRole('button', { name: 'Make public' }).click();

        await expect(dialog).toHaveCount(0);
        await expect(page.getByText('Who can see it')).toBeVisible();
        await expect(page.getByRole('radio', { name: /^Private/u })).toHaveCount(0);
        await expect(page.getByRole('radio', { name: /^Public/u })).toHaveCount(0);
    });

    test('upsell, in the editor: Keep private leaves the recipe private', async ({ page }) => {
        await openPrivateRecipe(page, 'upsell', `/recipes/${PRIVATE_ID}/edit`);
        await expect(page.getByText("To make it private again, you'll need Premium.")).toBeVisible();

        await page.getByRole('radio', { name: /^Public/u }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Make this recipe public?' });
        await dialog.getByRole('button', { name: 'Keep private' }).click();

        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
    });

    test('⛔ hidden, on the recipe page: Make public asks first, then makes it public', async ({ page }) => {
        await openPrivateRecipe(page, 'hidden', `/recipes/${PRIVATE_ID}`);
        await expect(page.getByRole('heading', { name: 'Secret Stew' })).toBeVisible();
        await page.getByRole('button', { name: /^More actions for /u }).click();

        await page.getByRole('menuitem', { name: 'Make public' }).click();

        const dialog = page.getByRole('alertdialog', { name: 'Make this recipe public?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Premium/u })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Make public' }).click();

        await expect(dialog).toHaveCount(0);
        // Public now, and under hidden nothing offers the way back.
        await page.getByRole('button', { name: /^More actions for /u }).click();
        await expect(page.getByRole('menuitem', { name: 'Make public' })).toHaveCount(0);
        await expect(page.getByRole('menuitem', { name: 'Make private' })).toHaveCount(0);
    });
});
