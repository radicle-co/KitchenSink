import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * Publish with Private chosen, where the server will refuse Private, opens a dialog and never goes public on its own
 * (owner ruling 2026-10-26). Case B here: an imported public-web recipe, held public by the server, that the cook marked
 * Private while they had Pro and then lost it, so the client knows the server will refuse Private: "This recipe can't
 * be private yet". Keep as draft and Publish as public carry equal weight; Escape and Close mean Keep as draft; only
 * "Publish as public" publishes. Case A (slots full) is covered by the component suites. The mobile twin is
 * `mobile/.maestro/recipes/publishBlockedAsk.yaml`.
 *
 * ⚠️ NOT RUN when written (no stack was available). The downgrade is simulated by re-mocking the profile as `upsell`
 * after Private was chosen, then letting the window-focus refetch deliver it; if the refetch is slower than the
 * assertion the spec fails on the first `toBeVisible`, not silently.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000a1';

/** Open an imported public-web draft, choose Private as an entitled cook, then lose the entitlement. */
async function openDowngradedDraft(page: Page): Promise<string[]> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const draft = makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Web Stew',
        cuisine: 'Italian',
        status: 'draft',
        visibility: 'public',
        sourceType: 'imported_public',
    });
    await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [draft] });
    await openRecipeEditor(page, RECIPE_ID);
    await page.getByRole('radio', { name: /^Private/u }).click();

    const writes: string[] = [];
    page.on('request', (request) => {
        if (request.method() !== 'GET' && new URL(request.url()).pathname.includes('/recipes')) {
            writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
    });

    await mockRecipeApi(page, { viewerId, paidFeatures: 'upsell', recipes: [draft] });
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
    });

    return writes;
}

test.describe('Publish of a Private the server will refuse', () => {
    test('⛔ asks first; Escape and Keep as draft publish nothing; Publish as public publishes', async ({ page }) => {
        const writes = await openDowngradedDraft(page);

        await page.getByRole('button', { name: 'Publish', exact: true }).click();

        const ask = page.getByRole('dialog', { name: 'This recipe can’t be private yet' });
        await expect(ask).toBeVisible();
        await expect(ask.getByText(/^A recipe from a public web page can only be public\./u)).toBeVisible();
        // Focus moves into the sheet, to its title (the Sheet's contract).
        await expect(ask.getByRole('heading', { name: 'This recipe can’t be private yet' })).toBeFocused();
        expect(writes).toEqual([]);

        // Escape means Keep as draft: it closes, nothing is sent, and Private is still the cook's choice.
        await page.keyboard.press('Escape');
        await expect(ask).toHaveCount(0);
        expect(writes).toEqual([]);
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();

        // Asked again, Keep as draft says the same.
        await page.getByRole('button', { name: 'Publish', exact: true }).click();
        await ask.getByRole('button', { name: 'Keep as draft' }).click();
        await expect(ask).toHaveCount(0);
        expect(writes).toEqual([]);

        // Only this publishes, and the choice moves to Public.
        await page.getByRole('button', { name: 'Publish', exact: true }).click();
        await ask.getByRole('button', { name: 'Publish as public' }).click();
        await expect(page).not.toHaveURL(new RegExp(`${route(`/recipes/${RECIPE_ID}/edit`)}$`, 'u'));
        expect(writes.some((write) => write.startsWith('PATCH') || write.startsWith('PUT'))).toBe(true);
    });
});
