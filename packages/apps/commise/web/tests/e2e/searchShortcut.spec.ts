import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { gotoAfterSettingsRead, mockSettingsApi } from './utils/settingsApi';

/**
 * The `/` search shortcut (WCAG 2.1.4 Character Key Shortcuts): one
 * document `keydown` listener focuses the page's search field. It is off when the cook turns it off in Profile, it never
 * fires where they are typing, and it leaves a slash alone on a page with nothing to search.
 *
 * The preference is a setting on the server (D19, ADR-0059), answered here by a stateful fake of the settings endpoint
 * that lives in the page, so there is nothing to put back. `profileSettings.spec.ts` owns the setting's own
 * behaviour. Selectors are role/label only (repo policy). Serial (Clerk-authed).
 */

/** Sign in, mock the library and open it. */
async function openRecipes(page: import('@playwright/test').Page) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-000000000028',
                ownerId: viewerId,
                title: 'Searchable Soup',
            }),
        ],
    });
    const settings = await mockSettingsApi(page);
    await page.goto(route('/recipes'));
    await expect(page.getByRole('searchbox').first()).toBeVisible();

    return settings;
}

test.describe('the / shortcut', () => {
    test('focuses the search field from anywhere on the page, and types no slash', async ({ page }) => {
        await openRecipes(page);

        await page.getByRole('heading', { level: 1 }).click();
        await page.keyboard.press('/');

        const search = page.getByRole('searchbox').first();

        await expect(search).toBeFocused();
        await expect(search).toHaveValue('');
    });

    test('never fires inside a text field: the slash is typed', async ({ page }) => {
        await openRecipes(page);

        const search = page.getByRole('searchbox').first();

        await search.click();
        await page.keyboard.press('/');

        await expect(search).toHaveValue('/');
    });

    test('does nothing once the cook turns it off in Profile, and works again when they turn it back on', async ({
        page,
    }) => {
        const settings = await openRecipes(page);

        await page.goto(route('/profile'));
        await page.getByRole('switch', { name: 'Keyboard shortcuts' }).click();
        await expect(page.getByRole('switch', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-checked', 'false');
        // A full page load aborts a request still in flight, so let the save land before leaving.
        await expect.poll(() => settings.current()).toEqual({ searchShortcut: false });

        await gotoAfterSettingsRead(page, route('/recipes'));
        await expect(page.getByRole('searchbox').first()).toBeVisible();
        await page.getByRole('heading', { level: 1 }).click();
        await page.keyboard.press('/');
        await expect(page.getByRole('searchbox').first()).not.toBeFocused();

        await page.goto(route('/profile'));
        // The switch shows the published default until the read lands; wait for the saved "off" before toggling it.
        await expect(page.getByRole('switch', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-checked', 'false');
        await page.getByRole('switch', { name: 'Keyboard shortcuts' }).click();
        await expect.poll(() => settings.current()).toEqual({ searchShortcut: true });
        await gotoAfterSettingsRead(page, route('/recipes'));
        await expect(page.getByRole('searchbox').first()).toBeVisible();
        await page.getByRole('heading', { level: 1 }).click();
        await page.keyboard.press('/');
        await expect(page.getByRole('searchbox').first()).toBeFocused();
    });

    test('is a plain slash on a page with no search field', async ({ page }) => {
        await signInWithTicket(page);
        await mockRecipeApi(page);
        await mockSettingsApi(page);
        await page.goto(route('/profile'));
        await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();

        await page.getByRole('heading', { level: 1 }).click();
        // Nothing to focus, so nothing is prevented: the keypress reaches the page untouched.
        const prevented = await page.evaluate(
            () =>
                new Promise<boolean>((resolve) => {
                    const probe = (event: KeyboardEvent): void => {
                        document.removeEventListener('keydown', probe, true);
                        // Read after the bubbling listeners ran.
                        setTimeout(() => resolve(event.defaultPrevented), 0);
                    };

                    document.addEventListener('keydown', probe, true);
                    document.body.dispatchEvent(
                        new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
                    );
                }),
        );

        expect(prevented).toBe(false);
    });
});
