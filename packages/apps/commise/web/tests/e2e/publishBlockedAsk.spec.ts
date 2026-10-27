import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * Publish with Private chosen, where the recipe cannot be private, opens a dialog and never goes public on its own
 * (owner ruling 2026-10-26, ADR-0073). Keep as draft and Publish as public carry equal weight, neither preselected; Escape
 * and Close mean Keep as draft; only "Publish as public" publishes. The mobile twin is
 * `mobile/.maestro/recipes/publishBlockedAsk.yaml`. "See Pro" is hidden until feature 010 sells it
 * (`SUBSCRIPTION_ENTRY_POINTS_ON`), so the dialog shows no upsell line here.
 *
 * ## The real path, with nothing simulated in the page
 *
 * The first version of this spec lost Pro by re-mocking the profile and dispatching a window-focus event, hoping the
 * profile would refetch. It cannot: the profile stays fresh for two minutes, so the page never heard of the downgrade
 * and the spec could only have failed. This one answers the way a cook meets it.
 *
 * - **The server refuses (ADR-0073, `403 PRIVATE_SLOTS_FULL`).** The page's own read of the slots says one is free, as
 *   it does when another device used the last one since the read. The stubbed service, which holds the real rule
 *   (`utils/recipeApi`, the same count and the same refusal the recipe service makes), counts the slots full when the
 *   Publish arrives, so the dialog opens from the server's answer and names the server's limit.
 * - **Not driven here: the public-web-page rule.** That ask comes from a Private the editor KNOWS the service will refuse,
 *   which needs a kept Private to survive the loss of Pro. Measured in a browser (2026-10-27): a page that loads after
 *   the loss shows Public chosen, with "If it still can't be private when you publish, we will ask", so the editor drops
 *   the choice on load and there is no way to reach the ask without simulating state in the page, which is the mistake
 *   the first version made. Its dialog is covered by `PublishBlockedSheet.test.tsx` and the `useRecipeEditor` and
 *   `RecipeEditorSurface` suites, and on the phone by the Maestro twin.
 *
 * What the server holds is read from the stub's store, which is what a publish writes to: a Publish that went public
 * would show there as `published`.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000a1';
const TITLE = 'Web Stew';

/** The editor's Publish control (the page also has a section named for it). */
const publish = (page: Page) => page.getByRole('button', { name: 'Publish', exact: true });

/** The dialog by its title. */
const ask = (page: Page, title: string) => page.getByRole('dialog', { name: title });

/** A draft the viewer owns, public as the service holds every new draft. */
const draftOf = (viewerId: string, over: Parameters<typeof makeRecipeDetail>[0] = {}) =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: TITLE,
        cuisine: 'Italian',
        status: 'draft',
        visibility: 'public',
        currentVersion: 1,
        ...over,
    });

/**
 * Answer the editor's private-slot read with one free slot, as it reads after another device used the last one.
 *
 * @param page - The page, after `mockRecipeApi` (a later route wins).
 */
async function reportAFreeSlot(page: Page): Promise<void> {
    await page.route('**/api/v1/recipes/private-slots', (request) =>
        request.fulfill({ json: { kind: 'limited', used: 0, limit: 1 } }),
    );
}

test.describe('Publish of a Private that cannot be kept', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
    });

    test('⛔ the server counts the slots full: asks first; Escape and Keep as draft publish nothing; Publish as public publishes', async ({
        page,
    }) => {
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'upsell',
            privateSlotLimit: 1,
            recipes: [
                // The one slot, used: a published private recipe of the cook's own.
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-0000000000b1',
                    ownerId: viewerId,
                    title: 'Slot Holder',
                    status: 'published',
                    visibility: 'private',
                }),
                draftOf(viewerId),
            ],
        });
        await reportAFreeSlot(page);

        await openRecipeEditor(page, RECIPE_ID);
        await page.getByRole('radio', { name: /^Private/u }).click();
        await publish(page).click();

        const dialog = ask(page, 'Your private slots are full');
        await expect(dialog).toBeVisible();
        // The number is the server's: the page's own read said none were used.
        await expect(dialog.getByText(/^All 1 of your private slots are in use/u)).toBeVisible();
        await expect(dialog.getByRole('heading', { name: 'Your private slots are full' })).toBeFocused();
        // Two buttons of equal weight, and no Pro sale while feature 010 does not exist.
        await expect(dialog.getByRole('button', { name: 'Keep as draft' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Publish as public' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'See Pro' })).toHaveCount(0);
        expect(store.get(RECIPE_ID)?.status).toBe('draft');

        // Escape means Keep as draft: it closes, the recipe is still a draft, and Private is still the cook's choice.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        expect(store.get(RECIPE_ID)?.status).toBe('draft');
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();

        // Asked again, Keep as draft says the same.
        await publish(page).click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Keep as draft' }).click();
        await expect(dialog).toHaveCount(0);
        expect(store.get(RECIPE_ID)?.status).toBe('draft');
        expect(store.get(RECIPE_ID)?.visibility).not.toBe('public');

        // Only this publishes, and it publishes as public.
        await publish(page).click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Publish as public' }).click();
        await expect(page).not.toHaveURL(new RegExp(`${route(`/recipes/${RECIPE_ID}/edit`)}$`, 'u'));
        await expect.poll(() => store.get(RECIPE_ID)?.status).toBe('published');
        expect(store.get(RECIPE_ID)?.visibility).toBe('public');
    });
});
