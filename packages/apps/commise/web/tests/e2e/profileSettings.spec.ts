import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { gotoAfterSettingsRead, mockSettingsApi } from './utils/settingsApi';

/**
 * User settings on the server (owner ruling D19, ADR-0059), through the one setting there is: the web `/` search
 * shortcut. The choice is saved to the identity service and read back, so it survives a reload and nothing is kept in
 * browser storage.
 *
 * The identity service is mocked at the network edge by a small stateful fake (`utils/settingsApi.ts`), in the way
 * `profile.spec.ts` mocks the profile read, so the spec asserts exactly what reaches the wire and what a reload reads
 * back. The fake lives in the page, so each test starts from the state it arranges and there is nothing to restore.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`. Serial (Clerk-authed).
 */

const SWITCH = 'Keyboard shortcuts';

/** Sign in, mock the library and the settings endpoint, and return the handle to the fake settings server. */
async function arrange(page: Page, initial: { readonly searchShortcut: boolean }) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-000000000059',
                ownerId: viewerId,
                title: 'Settings Soup',
            }),
        ],
    });

    return mockSettingsApi(page, initial);
}

/** Press `/` from the page heading and report whether the first search field took focus. */
async function slashFocusesSearch(page: Page): Promise<boolean> {
    await gotoAfterSettingsRead(page, route('/recipes'));
    await expect(page.getByRole('searchbox').first()).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('/');

    return page
        .getByRole('searchbox')
        .first()
        .evaluate((field) => field === document.activeElement);
}

test.describe('the keyboard-shortcuts setting', () => {
    test('is on until the cook turns it off, and the switch says so', async ({ page }) => {
        await arrange(page, { searchShortcut: true });

        await page.goto(route('/profile'));

        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true');
    });

    test('saves the choice to the server, keeps it across a reload, and then "/" does nothing', async ({ page }) => {
        const settings = await arrange(page, { searchShortcut: true });

        await page.goto(route('/profile'));
        await page.getByRole('switch', { name: SWITCH }).click();

        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');
        await expect.poll(() => settings.patches).toEqual([{ searchShortcut: false }]);
        expect(settings.current()).toEqual({ searchShortcut: false });

        await page.reload();

        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');
        expect(await slashFocusesSearch(page)).toBe(false);
    });

    test('keeps NOTHING in browser storage', async ({ page }) => {
        await arrange(page, { searchShortcut: true });

        await page.goto(route('/profile'));
        await page.getByRole('switch', { name: SWITCH }).click();
        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');

        const stored = await page.evaluate(() =>
            Object.keys(window.localStorage).filter((key) => key.startsWith('prefs.')),
        );

        expect(stored).toEqual([]);
    });

    test('turns "/" back on when the cook turns the switch back on', async ({ page }) => {
        const settings = await arrange(page, { searchShortcut: false });

        await page.goto(route('/profile'));
        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');
        await page.getByRole('switch', { name: SWITCH }).click();
        await expect.poll(() => settings.current()).toEqual({ searchShortcut: true });

        expect(await slashFocusesSearch(page)).toBe(true);
    });

    test('puts the switch back and says so when the server refuses the save', async ({ page }) => {
        const settings = await arrange(page, { searchShortcut: true });

        await page.goto(route('/profile'));
        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true');
        settings.failWrites(403);
        await page.getByRole('switch', { name: SWITCH }).click();

        await expect(
            page.getByRole('alert').filter({ hasText: 'We couldn’t save that setting. Try again.' }),
        ).toBeVisible();
        await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true');
        expect(settings.current()).toEqual({ searchShortcut: true });
    });
});
