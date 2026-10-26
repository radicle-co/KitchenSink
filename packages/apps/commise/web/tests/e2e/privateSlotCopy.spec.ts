import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The private-slot copy (ADR-0073; redesign canvas v44): the refusal of "Save a copy" when no private slot is free, and the
 * editor's Public option for a book or paid-site recipe. Driven through the real web UI with the recipe-service contract
 * intercepted (`utils/recipeApi`), which mirrors the service's `403 PRIVATE_SLOTS_FULL` for a copy that would be private.
 *
 * The refusal is driven by the SERVER's answer, so these specs prove the page's response to it. Whether a given recipe's
 * copy lands private is the service's rule (`defaultCloneVisibility`), covered by its own LOCAL e2e. Role/label selectors
 * only.
 */
const SOURCE_ID = 'ec000000-0000-4000-8000-0000000000c1';
const HELD_ID = 'ec000000-0000-4000-8000-0000000000c2';
const HELD_TOO_ID = 'ec000000-0000-4000-8000-0000000000c4';
const BOOK_ID = 'ec000000-0000-4000-8000-0000000000c3';

async function openSource(page: Page, paidFeatures: 'upsell' | 'hidden'): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        paidFeatures,
        // Two slots, both taken by recipes the viewer holds privately.
        privateSlotLimit: 2,
        recipes: [
            makeRecipeDetail({
                id: SOURCE_ID,
                ownerId: 'usr_other',
                title: 'Public Paella',
                visibility: 'public',
            }),
            makeRecipeDetail({ id: HELD_ID, ownerId: viewerId, title: 'Held Dish', visibility: 'private' }),
            makeRecipeDetail({ id: HELD_TOO_ID, ownerId: viewerId, title: 'Held Too', visibility: 'private' }),
        ],
    });
    await page.goto(route(`/recipes/${SOURCE_ID}`));
    await expect(page.getByRole('heading', { name: 'Public Paella' })).toBeVisible();
}

test.describe('Save a copy with no private slot', () => {
    test('upsell: the copy is refused before it is made, with Not now and See Premium and no way to make it public', async ({
        page,
    }) => {
        await openSource(page, 'upsell');
        const url = page.url();

        await page.getByRole('button', { name: 'Save a copy' }).click();

        const dialog = page.getByRole('dialog', { name: 'No private slot for this copy' });
        await expect(dialog).toBeVisible();
        await expect(
            dialog.getByText(
                'This copy would be private, and all 2 of your private slots are in use. To free a slot, make a private recipe public or delete one. Premium has no limit.',
            ),
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'See Premium' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /public/iu })).toHaveCount(0);

        await dialog.getByRole('button', { name: 'Not now' }).click();

        await expect(dialog).toHaveCount(0);
        // No copy was made: the page did not move on to an editor.
        expect(page.url()).toBe(url);
    });

    test('⛔ hidden: the same refusal says no word of Premium and offers one OK', async ({ page }) => {
        await openSource(page, 'hidden');

        await page.getByRole('button', { name: 'Save a copy' }).click();

        const dialog = page.getByRole('dialog', { name: 'No private slot for this copy' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/Premium/u)).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Not now' })).toHaveCount(0);

        await dialog.getByRole('button', { name: 'OK' }).click();

        await expect(dialog).toHaveCount(0);
    });
});

test.describe('a book or paid-site recipe in the editor', () => {
    async function openBook(page: Page): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'upsell',
            recipes: [
                makeRecipeDetail({
                    id: BOOK_ID,
                    ownerId: viewerId,
                    title: 'Grandma’s Book Cake',
                    visibility: 'private',
                    sourceType: 'imported_physical',
                }),
            ],
        });
        await page.goto(route(`/recipes/${BOOK_ID}/edit`));
        await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
    }

    test('⛔ Public is refused, not disabled: focusable, with the reason as its description, and choosing it changes nothing', async ({
        page,
    }) => {
        await openBook(page);

        const pub = page.getByRole('radio', { name: /^Public/u });

        await expect(pub).toHaveAttribute('aria-disabled', 'true');
        await expect(pub).not.toBeDisabled();
        await expect(pub).toHaveAccessibleDescription(
            'Not for this recipe. Its source is a book or a paid site, not a public web page.',
        );
        await pub.focus();
        await expect(pub).toBeFocused();

        await pub.click({ force: true });

        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });
});
