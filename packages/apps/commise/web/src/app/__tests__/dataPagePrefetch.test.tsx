/**
 * Unit tests for B19 (CP-9 Task 4) — SSR prefetch + `HydrationBoundary` on the four data pages
 * (`recipes`, `recipes/[id]`, `discover`, `collections`). Each page is called directly as the plain async
 * function it is (Next server-component pages need no framework runtime to invoke — only the returned
 * element tree is inspected here, so the client containers behind `HydrationBoundary` are never mounted and
 * need no provider stack). This proves:
 *
 *  1. The page prefetches on the EXACT P5 factory key/queryFn the client container's hook reads
 *     (`recipeQueries`/`collectionQueries` from `@kitchensink/recipe-service-client`) and dehydrates it —
 *     asserted by inspecting the `<HydrationBoundary state={dehydrate(queryClient)}>` element the page
 *     returns, per the brief's "unit test that the page dehydrates the right key" option.
 *  2. A failed SSR prefetch degrades to an EMPTY dehydrated state (never throws, never 500s) — TanStack
 *     Query's own contract (`prefetchQuery`/`prefetchInfiniteQuery` catch their query's error;
 *     `dehydrate()` only serializes `status: 'success'` queries by default), exercised here against a
 *     rejected client method.
 *  3. An unauthenticated caller is redirected BEFORE any prefetch is attempted (the pre-existing auth gate,
 *     unchanged by B19 — proven so the new prefetch code is confirmed to sit AFTER the gate, not before it).
 *
 * `@clerk/nextjs/server`'s `auth()` is mocked (it is server-only and has no request context under vitest).
 * `next/navigation`'s `redirect()` is mocked to THROW (mirroring its real `never`-typed behavior — Next's
 * real `redirect()` throws a control-flow signal the framework catches; none of the pages `return` after
 * calling it, so a no-op mock would silently fall through into the prefetch/render code below it).
 * `RecipeServiceClient` is the REAL class (CP-6 T3 pattern) with only its data methods spied per test, so a
 * signature drift on `listRecipes`/`getRecipeById`/`searchRecipes`/`listCollections` fails `tsc`, not just
 * the assertion at runtime.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DehydratedState, HydrationBoundaryProps } from '@tanstack/react-query';
import { HydrationBoundary } from '@tanstack/react-query';

import { makeCollection, makeRecipe, makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeSearchResponse } from '@kitchensink/recipe-service-client';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        // Mirrors Next's real `redirect()`: it never returns (typed `never`) — every page below relies on
        // this throwing to abort execution before its own prefetch/render code runs, exactly as production
        // Next.js does via its internal control-flow signal.
        throw new Error(`NEXT_REDIRECT:${url}`);
    }),
}));

const { auth } = await import('@clerk/nextjs/server');
const mockedAuth = vi.mocked(auth);

const { default: RecipesPage } = await import('../[locale]/recipes/page');
const { default: RecipeDetailPage } = await import('../[locale]/recipes/[id]/page');
const { default: RecipeCookingPage } = await import('../[locale]/recipes/[id]/cook/page');
const { default: DiscoverPage } = await import('../[locale]/discover/page');
const { default: CollectionsPage } = await import('../[locale]/collections/page');

/** Resolve `auth()` as an authenticated caller with a fixed session token. */
function mockAuthed(): void {
    mockedAuth.mockResolvedValue({
        userId: 'usr_1',
        getToken: async () => 'tok_1',
    } as unknown as Awaited<ReturnType<typeof auth>>);
}

/** Resolve `auth()` as signed-out (no session). */
function mockSignedOut(): void {
    mockedAuth.mockResolvedValue({
        userId: null,
        getToken: async () => null,
    } as unknown as Awaited<ReturnType<typeof auth>>);
}

/**
 * Pull the dehydrated queries off a page's returned element, asserting along the way that the element IS a
 * `<HydrationBoundary>` (not some other wrapper) and that it carries a non-null `state`.
 */
function dehydratedQueries(element: React.ReactElement): DehydratedState['queries'] {
    expect(element.type).toBe(HydrationBoundary);

    const props = element.props as HydrationBoundaryProps;

    expect(props.state).not.toBeNull();
    expect(props.state).not.toBeUndefined();

    return (props.state as DehydratedState).queries;
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('[locale]/recipes/page.tsx SSR prefetch', () => {
    it('prefetches the caller’s recipe list on recipeQueries(client).list() and dehydrates it', async () => {
        mockAuthed();
        const recipe = makeRecipe();
        const response = { data: [recipe], page: 1, pageSize: 20, total: 1, hasMore: false };
        vi.spyOn(RecipeServiceClient.prototype, 'listRecipes').mockResolvedValue(response);

        const element = await RecipesPage({ params: Promise.resolve({ locale: 'en' }) });
        const queries = dehydratedQueries(element);

        expect(queries).toHaveLength(1);
        expect(queries[0]?.queryKey).toEqual(recipeServiceKeys.recipeList());
        expect(queries[0]?.state.data).toEqual(response);
    });

    it('dehydrates to an empty state (no throw) when the SSR prefetch fails', async () => {
        mockAuthed();
        vi.spyOn(RecipeServiceClient.prototype, 'listRecipes').mockRejectedValue(new Error('network down'));

        const element = await RecipesPage({ params: Promise.resolve({ locale: 'en' }) });

        expect(dehydratedQueries(element)).toHaveLength(0);
    });

    it('redirects to sign-in and never prefetches when signed out', async () => {
        mockSignedOut();
        const listSpy = vi.spyOn(RecipeServiceClient.prototype, 'listRecipes');

        await expect(RecipesPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in',
        );
        expect(listSpy).not.toHaveBeenCalled();
    });
});

describe('[locale]/recipes/[id]/page.tsx SSR prefetch', () => {
    it('prefetches the recipe on recipeQueries(client).detail(id) and dehydrates it', async () => {
        mockAuthed();
        const detail = makeRecipeDetail({ id: 'rec_1' });
        vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById').mockResolvedValue(detail);

        const element = await RecipeDetailPage({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) });
        const queries = dehydratedQueries(element);

        expect(queries).toHaveLength(1);
        expect(queries[0]?.queryKey).toEqual(recipeServiceKeys.recipe('rec_1'));
        expect(queries[0]?.state.data).toEqual(detail);
    });

    it('dehydrates to an empty state (no throw) when the SSR prefetch fails (e.g. a 404)', async () => {
        mockAuthed();
        vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById').mockRejectedValue(new Error('not found'));

        const element = await RecipeDetailPage({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) });

        expect(dehydratedQueries(element)).toHaveLength(0);
    });

    it('redirects to sign-in and never prefetches when signed out', async () => {
        mockSignedOut();
        const detailSpy = vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById');

        await expect(RecipeDetailPage({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) })).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in',
        );
        expect(detailSpy).not.toHaveBeenCalled();
    });
});

describe('[locale]/recipes/[id]/cook/page.tsx SSR prefetch', () => {
    // Feature 008 (T-011). Cooking Mode adds NO endpoint: it prefetches the SAME `recipeQueries(client)
    // .detail(id)` key the recipe-detail page does, which is what lets a cook entering from the detail page
    // start on step one with no second round trip. A key that drifted from the container's own
    // `useRecipe(id)` would look identical on screen while silently double-fetching.
    it('prefetches the recipe on recipeQueries(client).detail(id) — the SAME key the detail page uses', async () => {
        mockAuthed();
        const detail = makeRecipeDetail({ id: 'rec_1' });
        vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById').mockResolvedValue(detail);

        const element = await RecipeCookingPage({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) });
        const queries = dehydratedQueries(element);

        expect(queries).toHaveLength(1);
        expect(queries[0]?.queryKey).toEqual(recipeServiceKeys.recipe('rec_1'));
        expect(queries[0]?.state.data).toEqual(detail);
    });

    it('dehydrates to an empty state (no throw) when the SSR prefetch fails', async () => {
        mockAuthed();
        vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById').mockRejectedValue(new Error('not found'));

        const element = await RecipeCookingPage({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) });

        expect(dehydratedQueries(element)).toHaveLength(0);
    });

    it('redirects to sign-in and never prefetches when signed out', async () => {
        mockSignedOut();
        const detailSpy = vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById');

        await expect(RecipeCookingPage({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) })).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in',
        );
        expect(detailSpy).not.toHaveBeenCalled();
    });
});

describe('[locale]/discover/page.tsx SSR prefetch', () => {
    it('prefetches the infinite search on recipeQueries(client).searchInfinite(params) from the URL', async () => {
        mockAuthed();
        const response: RecipeSearchResponse = {
            results: [{ recipe: makeRecipe({ visibility: 'public' as never }) }],
            facets: {},
            total: 1,
            page: 1,
            pageSize: 20,
            hasMore: false,
        };
        vi.spyOn(RecipeServiceClient.prototype, 'searchRecipes').mockResolvedValue(response);

        const element = await DiscoverPage({
            params: Promise.resolve({ locale: 'en' }),
            searchParams: Promise.resolve({ query: 'paella', dietaryFlags: ['vegan'] }),
        });
        const queries = dehydratedQueries(element);

        expect(queries).toHaveLength(1);
        // sortBy defaults to RELEVANCE, matching the container's initial (URL-independent) view state.
        expect(queries[0]?.queryKey).toEqual(
            recipeServiceKeys.recipeSearch({ query: 'paella', dietaryFlags: ['vegan'], sortBy: 'relevance' }),
        );
        // The infinite query shape: one fetched page, page 1.
        expect(queries[0]?.state.data).toEqual({ pages: [response], pageParams: [1] });
    });

    it('dehydrates to an empty state (no throw) when the SSR prefetch fails', async () => {
        mockAuthed();
        vi.spyOn(RecipeServiceClient.prototype, 'searchRecipes').mockRejectedValue(new Error('network down'));

        const element = await DiscoverPage({
            params: Promise.resolve({ locale: 'en' }),
            searchParams: Promise.resolve({}),
        });

        expect(dehydratedQueries(element)).toHaveLength(0);
    });

    it('redirects to sign-in and never prefetches when signed out', async () => {
        mockSignedOut();
        const searchSpy = vi.spyOn(RecipeServiceClient.prototype, 'searchRecipes');

        await expect(
            DiscoverPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
        ).rejects.toThrow('NEXT_REDIRECT:/en/sign-in');
        expect(searchSpy).not.toHaveBeenCalled();
    });
});

describe('[locale]/collections/page.tsx SSR prefetch', () => {
    it('prefetches the caller’s collections on collectionQueries(client).listInfinite() and dehydrates it', async () => {
        mockAuthed();
        const response = { data: [makeCollection()], page: 1, pageSize: 20, total: 1, hasMore: false };
        vi.spyOn(RecipeServiceClient.prototype, 'listCollections').mockResolvedValue(response);

        const element = await CollectionsPage({ params: Promise.resolve({ locale: 'en' }) });
        const queries = dehydratedQueries(element);

        expect(queries).toHaveLength(1);
        expect(queries[0]?.queryKey).toEqual(recipeServiceKeys.collectionList());
        // The infinite query shape: one fetched page, page 1.
        expect(queries[0]?.state.data).toEqual({ pages: [response], pageParams: [1] });
    });

    it('dehydrates to an empty state (no throw) when the SSR prefetch fails', async () => {
        mockAuthed();
        vi.spyOn(RecipeServiceClient.prototype, 'listCollections').mockRejectedValue(new Error('network down'));

        const element = await CollectionsPage({ params: Promise.resolve({ locale: 'en' }) });

        expect(dehydratedQueries(element)).toHaveLength(0);
    });

    it('redirects to sign-in and never prefetches when signed out', async () => {
        mockSignedOut();
        const listSpy = vi.spyOn(RecipeServiceClient.prototype, 'listCollections');

        await expect(CollectionsPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in',
        );
        expect(listSpy).not.toHaveBeenCalled();
    });
});
