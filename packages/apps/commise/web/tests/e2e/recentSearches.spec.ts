import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recent searches on the discovery keyword field (U7), driven through the real web UI (Next dev server +
 * Clerk session + client hooks) with the recipe-service HTTP contract intercepted (`utils/recipeApi`).
 *
 * Playwright IS this user story's integration test (CLAUDE.md testing policy), and it is the only tier that
 * can prove the parts the component/hook tests cannot: that the history reaches REAL `localStorage`, survives
 * a real page reload, and that choosing an entry re-runs the search all the way to the API — the mock narrows
 * server-side on `query`, so a UI that only filled the field without re-fetching would keep rendering the
 * non-matching recipe and fail here.
 *
 * The list rules (newest-first, case-insensitive de-duplication, the cap) are covered by the pure model's
 * unit tests, and the panel's visibility rules by the shared view's component tests; this spec deliberately
 * does not re-prove them. Selectors are role/label only. The mobile equivalent is
 * `.maestro/recipes/discover-recent-searches.yaml` (emulator/CI only).
 */
test.describe('discovery recent searches (U7)', () => {
    test('a search that ran is remembered, survives a reload, re-runs on tap, and can be cleared', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'rec_paella', ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: 'rec_pasta', ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        await page.goto(route('/discover'));
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();

        const searchBox = page.getByRole('searchbox', { name: 'Search public recipes' });

        // Nothing is remembered yet — the panel must not appear on an empty history.
        await searchBox.click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);

        // Run a real search…
        await searchBox.fill('paella');
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);

        // …then return to the idle state: the search that RAN is offered back.
        await searchBox.fill('');
        await expect(page.getByRole('button', { name: 'Search for “paella”' })).toBeVisible();

        // It survives a real reload — i.e. it genuinely reached `localStorage`, not just React state.
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
        await searchBox.click();
        await expect(page.getByRole('button', { name: 'Search for “paella”' })).toBeVisible();

        // Choosing it re-runs the search end to end: the field carries it AND the non-match disappears,
        // which can only happen if `query=paella` reached the API again.
        await page.getByRole('button', { name: 'Search for “paella”' }).click();
        await expect(searchBox).toHaveValue('paella');
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);

        // Clear-all empties the history: back to the idle state, nothing is offered.
        await searchBox.fill('');
        await page.getByRole('button', { name: 'Clear recent searches' }).click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);

        // And the emptied history stays empty across a reload (the clear was persisted, not just local).
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
        await searchBox.click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);
    });
});
