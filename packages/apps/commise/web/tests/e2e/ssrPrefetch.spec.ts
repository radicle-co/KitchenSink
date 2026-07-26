import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * B19 (CP-9 Task 4) — SSR prefetch + `HydrationBoundary` on the four data pages, observed end-to-end.
 *
 * The web e2e harness cannot mock the Next.js SERVER's own outbound fetch: `page.route` only intercepts
 * requests the BROWSER issues, but a `page.tsx`'s server-side `RecipeServiceClient` prefetch runs inside the
 * Next dev-server's own Node process and never touches the browser's network stack. In THIS harness
 * `NEXT_PUBLIC_API_URL` resolves to the web app's own origin (`.env.local` — no recipe API listens there), so
 * every SSR prefetch below deterministically FAILS with a 404 from the Next server itself (not a connection
 * refusal, since something IS listening on that port — just not the recipe API). That is not a gap to work
 * around — it IS the environment this suite proves B19's required degradation contract against: "a prefetch
 * failure should NOT break the page; the client will refetch" (see each page's own B19 doc comment).
 *
 * What this spec proves, deterministically, for all four data pages:
 *
 *  1. The page still returns `200` (never a `500`) when its OWN SSR prefetch fails.
 *  2. The client container still renders the SEEDED data, via the BROWSER-side mock `mockRecipeApi`
 *     installs — proving the client-side refetch takes over cleanly behind an empty-dehydrated
 *     `HydrationBoundary`, exactly the "prefetch failure → the page still renders (degrades to client
 *     fetch), does NOT 500" requirement.
 *
 * A true "no client-loading-flash" proof needs the SSR prefetch to SUCCEED against real/mocked data, which
 * needs the Next server's own outbound fetch to be interceptable — this harness has no such seam (see above).
 * The per-page dehydration unit tests (`src/app/__tests__/dataPagePrefetch.test.tsx`) cover THAT half of
 * B19's contract instead, by mocking `RecipeServiceClient`'s methods directly and asserting the dehydrated
 * cache holds the P5-aligned key + data.
 */
test.describe('SSR prefetch degradation (B19)', () => {
    test('recipes list renders via client fetch after its SSR prefetch fails, without a server error', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_ssr', ownerId: viewerId, title: 'SSR Prefetch Recipe' })],
        });

        const response = await page.goto(route('/recipes'));

        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'SSR Prefetch Recipe' })).toBeVisible();
    });

    test('recipe detail renders via client fetch after its SSR prefetch fails, without a server error', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_ssr', ownerId: viewerId, title: 'SSR Prefetch Recipe' })],
        });

        const response = await page.goto(route('/recipes/rec_ssr'));

        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'SSR Prefetch Recipe' })).toBeVisible();
    });

    test('discover renders via client fetch after its SSR prefetch fails, without a server error', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_ssr', ownerId: 'usr_other', title: 'SSR Prefetch Recipe' })],
        });

        const response = await page.goto(route('/discover'));

        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
        // With no query, U7's discovery default is the CURATED RAILS surface (Trending / New / Quick), not a
        // flat relevance stream — so the seeded recipe legitimately renders once per rail (three sorts of the
        // same public corpus; a recipe can be the newest AND the quickest). This spec's claim is only that the
        // client refetch rendered the seeded data at all, so it asserts on the first card rather than
        // pretending the name is unique on the page.
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'SSR Prefetch Recipe' }).first()).toBeVisible();
    });

    test('collections list renders via client fetch after its SSR prefetch fails, without a server error', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            collections: [makeCollection({ id: 'col_ssr', ownerId: viewerId, name: 'SSR Prefetch Collection' })],
        });

        const response = await page.goto(route('/collections'));

        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'SSR Prefetch Collection' })).toBeVisible();
    });
});
