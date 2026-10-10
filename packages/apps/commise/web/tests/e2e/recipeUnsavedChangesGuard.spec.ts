/**
 * REWRITTEN for slice 7 (build spec §13: "rewritten for the resume notice"). The wizard's discard guard asked before
 * leaving; the one-page editor never asks (Settled 24), because nothing is lost: a published recipe's changes stay in
 * this tab (owner D1, D7) until the cook presses Save changes. What a browser shows here:
 *
 * - leaving an edited published recipe asks nothing, and reopening it brings the changes back with the resume notice;
 * - the notice's Save changes writes them as one update, and its Discard (confirmed) drops them;
 * - the browser's own unload prompt is armed only while such changes stand — the one state where closing the tab loses
 *   work (`staff-ux-engineer`, slice 7).
 */
import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

const RECIPE_ID = 'ec000000-0000-4000-8000-000000000026';

/** Sign in, seed one published recipe the viewer owns, and open its editor. */
async function openPublished(page: Page) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const store = await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Resume Stew',
                status: 'published',
                currentVersion: 2,
            }),
        ],
    });

    await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
    await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();

    return store;
}

/** Edit the description and wait for the device draft, which is written one second after typing stops. */
async function editAndKeep(page: Page, description: string): Promise<void> {
    await page.getByLabel('Description').fill(description);
    await expect(page.getByText('Changes kept in this tab')).toBeVisible();
}

test.describe('a published recipe`s changes kept in this tab (D1, D7)', () => {
    test('× leaves without asking, and reopening brings the changes back with the resume notice', async ({ page }) => {
        await openPublished(page);
        await editAndKeep(page, 'Thicker, with barley.');

        await page.getByRole('button', { name: 'Close editor' }).click();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 1, name: 'Resume Stew' })).toBeVisible();

        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));

        await expect(page.getByRole('region', { name: /You have changes from/u })).toBeVisible();
        await expect(page.getByLabel('Description')).toHaveValue('Thicker, with barley.');
    });

    test('the notice`s Save changes writes them as ONE update', async ({ page }) => {
        const store = await openPublished(page);
        await editAndKeep(page, 'Saved from the notice.');
        await page.reload();

        await page
            .getByRole('region', { name: /You have changes from/u })
            .getByRole('button', { name: 'Save changes' })
            .click();

        await expect(page.getByRole('heading', { level: 1, name: 'Resume Stew' })).toBeVisible();
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(3);
        expect(store.get(RECIPE_ID)?.description).toBe('Saved from the notice.');
    });

    test('the notice`s Discard asks first, then drops the changes and writes nothing', async ({ page }) => {
        const store = await openPublished(page);
        await editAndKeep(page, 'To be discarded.');
        await page.reload();

        await page
            .getByRole('region', { name: /You have changes from/u })
            .getByRole('button', { name: 'Discard' })
            .click();
        const dialog = page.getByRole('alertdialog', { name: 'Discard your changes?' });
        await dialog.getByRole('button', { name: 'Discard' }).click();

        await expect(page.getByRole('heading', { level: 1, name: 'Resume Stew' })).toBeVisible();
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(2);

        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await expect(page.getByRole('region', { name: /You have changes from/u })).toHaveCount(0);
    });

    test('the browser`s unload prompt is armed only while the changes stand', async ({ page }) => {
        await openPublished(page);
        let prompted = 0;
        page.on('dialog', (dialog) => {
            prompted += 1;
            void dialog.dismiss();
        });

        // Unedited: nothing to lose, so a reload completes and does not prompt.
        await page.reload();
        expect(prompted).toBe(0);

        await editAndKeep(page, 'Kept only here.');
        // `beforeunload` fires for a close or a reload; Playwright surfaces the prompt as a dialog. Dismissing it CANCELS
        // the reload, so the reload itself never settles: the proof is the dialog, awaited on its own.
        const prompt = page.waitForEvent('dialog');
        void page.reload().catch(() => undefined);

        expect((await prompt).type()).toBe('beforeunload');
        expect(prompted).toBe(1);
    });
});
