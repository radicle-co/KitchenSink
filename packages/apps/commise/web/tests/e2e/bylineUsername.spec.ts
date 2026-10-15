import { expect, test, type Page } from '@playwright/test';

import { makeUserProfileAccount, makeUserProfileUser } from '@commise/features-account/testing';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The Clerk username is the public byline (owner ruling 2026-10-13; plan 2026-10-15-010 D11/D12), driven through the
 * real web UI with the recipe-service and identity contracts intercepted. Another cook's recipe reads "@username
 * (Display Name)" on its Discover card and "by @username (Display Name)" on its page; an erased author reads "Former
 * member", never the `user_<ULID>` pseudonym; the cook's own Profile shows their username read-only.
 *
 * Role/label selectors only. The byline wraps each piece of user text in invisible bidi isolates, so text is matched
 * by its visible parts rather than as one exact string.
 */
const OTHER_COOK = 'usr_other';

async function discoverWith(
    page: Page,
    author: { authorUsername?: string; authorDisplayName?: string },
): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: E2E_RECIPE_IDS.paella,
                ownerId: OTHER_COOK,
                title: 'Seafood Paella',
                visibility: 'public',
                ...author,
            }),
        ],
    });
}

test.describe('the byline is the username', () => {
    test('a Discover card reads “@username (Display Name)”', async ({ page }) => {
        await discoverWith(page, { authorUsername: 'braise', authorDisplayName: 'Eliza Moreno' });
        await page.goto(route('/discover'));

        const card = page.getByRole('article', { name: 'Seafood Paella' });
        await expect(card).toContainText('@braise (Eliza Moreno)');
    });

    test('the recipe page names the author “by @username (Display Name)”', async ({ page }) => {
        await discoverWith(page, { authorUsername: 'braise', authorDisplayName: 'Eliza Moreno' });
        await page.goto(route(`/recipes/${E2E_RECIPE_IDS.paella}`));

        await expect(page.getByRole('heading', { level: 1, name: 'Seafood Paella' })).toBeVisible();
        await expect(page.getByRole('main')).toContainText(/by\s.*@braise.*Eliza Moreno/u);
    });

    test('an author with no username is named without an “@”', async ({ page }) => {
        await discoverWith(page, { authorDisplayName: 'Eliza Moreno' });
        await page.goto(route('/discover'));

        const card = page.getByRole('article', { name: 'Seafood Paella' });
        await expect(card).toContainText('Eliza Moreno');
        await expect(card).not.toContainText('@');
    });

    test('an erased author reads “Former member”, never the pseudonym', async ({ page }) => {
        await discoverWith(page, { authorDisplayName: 'user_01J9ZK8N7QF3B2X4M6T0V5C1AB' });
        await page.goto(route('/discover'));

        const card = page.getByRole('article', { name: 'Seafood Paella' });
        await expect(card).toContainText('Former member');
        await expect(card).not.toContainText('user_');
    });

    test('the cook’s own Profile shows their username, read-only', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, { viewerId });
        // Registered AFTER `mockRecipeApi` so it wins: this spec's own cook, with a username.
        await page.route('**/api/v1/users/me', (request) =>
            request.fulfill({
                json: {
                    user: makeUserProfileUser({ id: viewerId, displayName: 'Eliza Moreno', username: 'braise' }),
                    account: makeUserProfileAccount({ userId: viewerId, paidFeatures: 'hidden' }),
                },
            }),
        );
        await page.goto(route('/profile'));

        await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
        const account = page.getByRole('region', { name: 'Account' });
        await expect(account).toContainText('Username');
        await expect(page.getByRole('main')).toContainText('@braise');
        await expect(page.getByRole('button', { name: /Username/u })).toHaveCount(0);
    });
});
