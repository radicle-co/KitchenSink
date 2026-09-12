import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
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
 * `.maestro/recipes/discoverRecentSearches.yaml` (emulator/CI only).
 *
 * ⛔ TWO WAITS ARE LOAD-BEARING, and each replaces one that passed vacuously in CI (run 34859669064).
 *  - **The rails before any interaction.** The frame (heading, search field) is server-rendered; the rails are not —
 *    `/discover` prefetches only the main search, so each rail's `ClientQueryBoundary` renders its loading state until
 *    the page has hydrated and the BROWSER fetches it. So the first rail card is this page's hydration witness.
 *    Without it, the field was clicked and filled before the rails' searches had even been issued, and the
 *    recent-search panel — which opens on a focus event React has to observe — was asserted with no proof the page
 *    had hydrated.
 *  - **The results sentence before any card.** One recipe sits in Trending, New AND Quick at once, so a bare card
 *    locator strict-fails while the rails are the body — and Playwright fails a strict-mode violation at once rather
 *    than retrying it. The old guard, `Weeknight Pasta` reaching `toHaveCount(0)`, is also true while the rails are
 *    still loading: it passed in 4 ms, before the rails' searches had even been answered, and the next assertion
 *    then met the rails. `Showing 1 recipe for “paella”` exists ONLY once the results for the term are on screen.
 */
test.describe('discovery recent searches (U7)', () => {
    test('a search that ran is remembered, survives a reload, re-runs on tap, and can be cleared', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: E2E_RECIPE_IDS.paella, ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: E2E_RECIPE_IDS.pasta, ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        const searchBox = page.getByRole('searchbox', { name: 'Search public recipes' });
        const pastaCard = page.getByRole('article', { name: 'Weeknight Pasta' });
        const paellaCard = page.getByRole('article', { name: 'Seafood Paella' });
        // Rendered twice by design — the visible results header and the frame's polite status region (see
        // `search.spec.ts`'s `discoverySentence`) — so exactly two is both halves present.
        const paellaResults = page.getByText('Showing 1 recipe for “paella”', { exact: true });

        /** Wait for discovery to hydrate, witnessed by the browser-fetched rails (see the file doc). */
        const waitForHydratedDiscovery = async (): Promise<void> => {
            await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
            await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
            await expect(pastaCard.first()).toBeVisible();
        };

        await page.goto(route('/discover'));
        await waitForHydratedDiscovery();

        // Nothing is remembered yet — the panel must not appear on an empty history.
        await searchBox.click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);

        // Run a real search. The results sentence FIRST (see the file doc): until it shows, the rails may still be the
        // body, where the match is three cards and the non-match is trivially present.
        await searchBox.fill('paella');
        await expect(paellaResults).toHaveCount(2);
        await expect(pastaCard).toHaveCount(0);
        await expect(paellaCard).toBeVisible();

        // …then return to the idle state: the search that RAN is offered back.
        await searchBox.fill('');
        await expect(page.getByRole('button', { name: 'Search for “paella”' })).toBeVisible();

        // It survives a real reload — i.e. it genuinely reached `localStorage`, not just React state.
        await page.reload();
        await waitForHydratedDiscovery();
        await searchBox.click();
        await expect(page.getByRole('button', { name: 'Search for “paella”' })).toBeVisible();

        // Choosing it re-runs the search end to end: the field carries it AND the non-match disappears,
        // which can only happen if `query=paella` reached the API again. The sentence first, for the rails reason above.
        await page.getByRole('button', { name: 'Search for “paella”' }).click();
        await expect(searchBox).toHaveValue('paella');
        await expect(paellaResults).toHaveCount(2);
        await expect(pastaCard).toHaveCount(0);
        await expect(paellaCard).toBeVisible();

        // Clear-all empties the history: back to the idle state, nothing is offered.
        await searchBox.fill('');
        await page.getByRole('button', { name: 'Clear recent searches' }).click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);

        // And the emptied history stays empty across a reload (the clear was persisted, not just local).
        await page.reload();
        await waitForHydratedDiscovery();
        await searchBox.click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);
    });
});
