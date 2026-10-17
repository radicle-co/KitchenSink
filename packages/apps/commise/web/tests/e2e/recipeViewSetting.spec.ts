import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { UserSettings } from '@kitchensink/schema-identity';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { gotoAfterSettingsRead, mockSettingsApi } from './utils/settingsApi';

/**
 * The recipe library's grid/list choice is an ACCOUNT setting (owner ruling 2026-10-17, ADR-0059): saved to the identity
 * service, read back after a reload, shared with the collection page, and kept in no cookie or browser storage. A failed
 * save puts the view back and says so.
 *
 * The identity service is mocked at the network edge by the stateful settings fake (`utils/settingsApi.ts`), so the spec
 * asserts exactly what reaches the wire and what a reload reads back. The server's own settings read (SSR) is not
 * interceptable from the page; with no identity service behind it, it fails and the client's read supplies the setting,
 * which is the degraded path the production page also takes when identity is down.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`. Serial (Clerk-authed).
 */

/** Sign in, mock the library and the settings endpoint, and return the handle to the fake settings server. */
async function arrange(page: Page, initial: Partial<UserSettings> = {}) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({ id: 'ec000000-0000-4000-8000-000000000071', ownerId: viewerId, title: 'View Soup' }),
        ],
    });

    return mockSettingsApi(page, initial);
}

const view = (page: Page) => page.getByRole('radiogroup', { name: 'View' });

test.describe('the recipe list view setting', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('defaults to the width’s view and writes nothing until the cook chooses', async ({ page }) => {
        const settings = await arrange(page);

        await page.goto(route('/recipes'));

        await expect(page.getByRole('article', { name: 'View Soup' })).toHaveAttribute('data-card-variant', 'grid');
        expect(settings.patches).toEqual([]);
    });

    test('saves the choice to the server, keeps it across a reload, and writes no cookie', async ({ page }) => {
        const settings = await arrange(page);

        await page.goto(route('/recipes'));
        await view(page).getByRole('radio', { name: 'List view' }).click();

        await expect(page.getByRole('article', { name: 'View Soup' })).toHaveAttribute('data-card-variant', 'row');
        await expect.poll(() => settings.patches).toEqual([{ recipeViewMode: 'list' }]);

        await gotoAfterSettingsRead(page, route('/recipes'));

        await expect(page.getByRole('article', { name: 'View Soup' })).toHaveAttribute('data-card-variant', 'row');
        expect((await page.context().cookies()).find((cookie) => cookie.name === 'recipes.viewMode')).toBeUndefined();
        expect(
            await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.includes('view'))),
        ).toEqual([]);
    });

    test('opens on the choice the account already holds', async ({ page }) => {
        await arrange(page, { recipeViewMode: 'list' });

        await page.goto(route('/recipes'));

        await expect(page.getByRole('article', { name: 'View Soup' })).toHaveAttribute('data-card-variant', 'row');
        await expect(view(page).getByRole('radio', { name: 'List view' })).toBeChecked();
    });

    test('puts the view back and says so when the server refuses the save', async ({ page }) => {
        const settings = await arrange(page, { recipeViewMode: 'grid' });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('article', { name: 'View Soup' })).toHaveAttribute('data-card-variant', 'grid');
        settings.failWrites(403);
        await view(page).getByRole('radio', { name: 'List view' }).click();

        await expect(
            page.getByRole('alert').filter({ hasText: 'We couldn’t save your view. Try choosing it again.' }),
        ).toBeVisible();
        await expect(page.getByRole('article', { name: 'View Soup' })).toHaveAttribute('data-card-variant', 'grid');
        expect(settings.current().recipeViewMode).toBe('grid');
    });
});
