import { expect, test, type Browser, type Page, type Request } from '@playwright/test';

import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * B19 (CP-9 Task 4) — SSR prefetch + `HydrationBoundary` on the four data pages, observed end-to-end.
 *
 * The web e2e harness cannot mock the Next.js SERVER's own outbound fetch: `page.route` only intercepts
 * requests the BROWSER issues, but a `page.tsx`'s server-side `RecipeServiceClient` prefetch runs inside the
 * Next server's own Node process and never touches the browser's network stack. In THIS harness
 * `NEXT_PUBLIC_API_URL` resolves to the web app's own origin (`.env.local` — no recipe API listens there), so
 * every SSR prefetch below deterministically FAILS with a 404 from the Next server itself (not a connection
 * refusal, since something IS listening on that port — just not the recipe API). That is not a gap to work
 * around — it IS the environment this suite proves B19's required degradation contract against: "a prefetch
 * failure should NOT break the page; the client will refetch" (see each page's own B19 doc comment).
 *
 * All four routes are `force-dynamic`, so under `next dev` (local) and `next start` (CI) alike every prefetch
 * fails AT REQUEST TIME; nothing is prerendered at build time.
 *
 * What this spec proves, deterministically, for all four data pages:
 *
 *  1. The page still returns `200` (never a `500`) when its OWN SSR prefetch fails.
 *  2. The client container still renders the SEEDED data, via the BROWSER-side mock `mockRecipeApi`
 *     installs — proving the client-side refetch takes over cleanly behind an empty-dehydrated
 *     `HydrationBoundary`, exactly the "prefetch failure → the page still renders (degrades to client
 *     fetch), does NOT 500" requirement.
 *  3. The SUSPENSE read boundary (`ClientQueryBoundary`, `docs/CODING_STANDARDS.md` §11.0) ships the right HTML
 *     when the prefetch failed: unhydrated (`unhydratedContext`), the server HTML carries the surface's frame
 *     (heading, and the search field where the surface has one) over its loading state, and no error; with the app
 *     running, the page hydrates with no hydration or recoverable-error console output, and the browser issues the
 *     read EXACTLY once — the boundary neither fetched on the server nor double-fetched after hydration.
 *
 * ⚠️ What this tier CANNOT express: the SUCCESSFUL-prefetch half — the server HTML carrying the rows and the browser
 * issuing ZERO reads after hydration. That needs the Next server's own outbound fetch to reach seeded data, which
 * this harness has no seam for (see above). It is owed by the deployed tier (`ssrPrefetchDeployed`, run against a
 * live preview) and is covered at the component level by the containers' server-render tests
 * (`tests/components/recipes/*Container.test.tsx`, `renderToString` + `hydrateRoot`) and by the per-page
 * dehydration unit tests (`src/app/__tests__/dataPagePrefetch.test.tsx`).
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

/** Console output that means hydration went wrong: a mismatch, or React's recoverable-error codes #418 / #419. */
const HYDRATION_ERROR = /hydrat|Minified React error #41[89]/iu;

/**
 * A browser context that shows the SERVER HTML as the server streamed it, and never hydrates. It holds the run's live
 * session.
 *
 * ⛔ Not `javaScriptEnabled: false`. Every one of these routes has a `loading.tsx`, so the document is STREAMED: the
 * shell flushes the route's loading fallback first, and the page's own HTML — the frame, the boundary's loading state —
 * arrives later in a `<div hidden id="S:…">` segment that React's INLINE `$RC`/`$RS` scripts move into place. With
 * JavaScript off those scripts never run, so the viewer is left on the route fallback while the HTML it asserts on sits
 * unrevealed in the document (CI run 34856885723 captured exactly that on all four routes). Instead, JavaScript stays
 * on and every script REQUEST is aborted: the inline reveal scripts are part of the server's response and run, while
 * the app's bundles and clerk-js never load — so nothing hydrates and nothing refetches, and what renders is the
 * server's output alone.
 *
 * The session is refreshed in a page that DOES run the app first — a restored Clerk session token is short-lived, and
 * without the app's scripts nothing could refresh it — and that context's state is handed to the new one.
 *
 * @sideEffect Navigates `page` to Home and opens a browser context the caller must close.
 */
async function unhydratedContext(browser: Browser, page: Page) {
    await signInWithTicket(page);

    const context = await browser.newContext({ storageState: await page.context().storageState() });
    await context.route('**/*', (intercepted) =>
        intercepted.request().resourceType() === 'script' ? intercepted.abort() : intercepted.fallback(),
    );

    return context;
}

/**
 * Record what a page does that only a hydrated client can get wrong: uncaught page errors, hydration console
 * errors, and the browser reads matching `isRead`.
 *
 * @sideEffect Subscribes to the page's `pageerror`, `console` and `request` events.
 */
function observe(page: Page, isRead: (request: Request) => boolean) {
    const pageErrors: string[] = [];
    const hydrationErrors: string[] = [];
    const reads: string[] = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && HYDRATION_ERROR.test(message.text())) {
            hydrationErrors.push(message.text());
        }
    });
    page.on('request', (request) => {
        if (request.method() === 'GET' && isRead(request)) {
            reads.push(request.url());
        }
    });

    return { pageErrors, hydrationErrors, reads };
}

/** Whether `request` targets exactly the API path `path` (query string ignored). */
const isPath =
    (path: string) =>
    (request: Request): boolean =>
        new URL(request.url()).pathname.endsWith(path);

/** The discover MAIN search — not a browse rail, which reads the same endpoint capped to a teaser `pageSize`. */
const isMainDiscoverySearch = (request: Request): boolean => {
    const url = new URL(request.url());

    return url.pathname.endsWith('/api/v1/search/recipes') && !url.searchParams.has('pageSize');
};

test.describe('suspense read boundary across a failed SSR prefetch (§11.0)', () => {
    test('recipes list: the server HTML is the frame over the loading state', async ({ browser, page }) => {
        const context = await unhydratedContext(browser, page);
        const unhydrated = await context.newPage();

        const response = await unhydrated.goto(route('/recipes'));

        expect(response?.status()).toBe(200);
        await expect(unhydrated.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(unhydrated.getByRole('searchbox', { name: 'Search recipes' })).toBeVisible();
        await expect(unhydrated.getByRole('status', { name: 'Loading recipes' })).toBeVisible();
        await expect(unhydrated.getByRole('alert')).toHaveCount(0);
        await context.close();
    });

    test('recipes list: hydrates cleanly and reads the library exactly once', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_ssr', ownerId: viewerId, title: 'SSR Prefetch Recipe' })],
        });
        const seen = observe(page, isPath('/api/v1/recipes'));

        const response = await page.goto(route('/recipes'));

        expect(response?.status()).toBe(200);
        // The document is not held back by the failed server read: the gate renders the skeleton instead of retrying.
        expect(response?.request().timing().responseEnd ?? Number.POSITIVE_INFINITY).toBeLessThan(2000);
        await expect(page.getByRole('article', { name: 'SSR Prefetch Recipe' })).toBeVisible();
        expect(seen.pageErrors).toEqual([]);
        expect(seen.hydrationErrors).toEqual([]);
        expect(seen.reads).toHaveLength(1);
    });

    test('recipe detail: the server HTML is the loading state', async ({ browser, page }) => {
        const context = await unhydratedContext(browser, page);
        const unhydrated = await context.newPage();

        const response = await unhydrated.goto(route('/recipes/rec_ssr'));

        expect(response?.status()).toBe(200);
        await expect(unhydrated.getByRole('status', { name: 'Loading recipe' })).toBeVisible();
        await expect(unhydrated.getByRole('alert')).toHaveCount(0);
        await context.close();
    });

    test('recipe detail: hydrates cleanly and reads the recipe exactly once', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_ssr', ownerId: viewerId, title: 'SSR Prefetch Recipe' })],
        });
        const seen = observe(page, isPath('/api/v1/recipes/rec_ssr'));

        const response = await page.goto(route('/recipes/rec_ssr'));

        expect(response?.status()).toBe(200);
        // The document is not held back by the failed server read: the gate renders the skeleton instead of retrying.
        expect(response?.request().timing().responseEnd ?? Number.POSITIVE_INFINITY).toBeLessThan(2000);
        await expect(page.getByRole('heading', { name: 'SSR Prefetch Recipe' })).toBeVisible();
        expect(seen.pageErrors).toEqual([]);
        expect(seen.hydrationErrors).toEqual([]);
        expect(seen.reads).toHaveLength(1);
    });

    test('discover: the server HTML is the frame over the loading state', async ({ browser, page }) => {
        const context = await unhydratedContext(browser, page);
        const unhydrated = await context.newPage();

        const response = await unhydrated.goto(route('/discover'));

        expect(response?.status()).toBe(200);
        await expect(unhydrated.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
        await expect(unhydrated.getByRole('searchbox', { name: 'Search public recipes' })).toBeVisible();
        await expect(unhydrated.getByRole('status', { name: 'Loading recipes' })).toBeVisible();
        await expect(unhydrated.getByRole('alert')).toHaveCount(0);
        await context.close();
    });

    test('discover: hydrates cleanly and runs the main search exactly once', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_ssr', ownerId: 'usr_other', title: 'SSR Prefetch Recipe' })],
        });
        const seen = observe(page, isMainDiscoverySearch);

        const response = await page.goto(route('/discover'));

        expect(response?.status()).toBe(200);
        // The document is not held back by the failed server read: the gate renders the skeleton instead of retrying.
        expect(response?.request().timing().responseEnd ?? Number.POSITIVE_INFINITY).toBeLessThan(2000);
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'SSR Prefetch Recipe' }).first()).toBeVisible();
        expect(seen.pageErrors).toEqual([]);
        expect(seen.hydrationErrors).toEqual([]);
        expect(seen.reads).toHaveLength(1);
    });

    test('collections list: the server HTML is the frame over the loading state', async ({ browser, page }) => {
        const context = await unhydratedContext(browser, page);
        const unhydrated = await context.newPage();

        const response = await unhydrated.goto(route('/collections'));

        expect(response?.status()).toBe(200);
        await expect(unhydrated.getByRole('heading', { name: 'Collections' })).toBeVisible();
        await expect(unhydrated.getByRole('status', { name: 'Loading collections' })).toBeVisible();
        await expect(unhydrated.getByRole('alert')).toHaveCount(0);
        await context.close();
    });

    test('collections list: hydrates cleanly and reads the collections exactly once', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            collections: [makeCollection({ id: 'col_ssr', ownerId: viewerId, name: 'SSR Prefetch Collection' })],
        });
        const seen = observe(page, isPath('/api/v1/collections'));

        const response = await page.goto(route('/collections'));

        expect(response?.status()).toBe(200);
        // The document is not held back by the failed server read: the gate renders the skeleton instead of retrying.
        expect(response?.request().timing().responseEnd ?? Number.POSITIVE_INFINITY).toBeLessThan(2000);
        await expect(page.getByRole('button', { name: 'SSR Prefetch Collection' })).toBeVisible();
        expect(seen.pageErrors).toEqual([]);
        expect(seen.hydrationErrors).toEqual([]);
        expect(seen.reads).toHaveLength(1);
    });
});
