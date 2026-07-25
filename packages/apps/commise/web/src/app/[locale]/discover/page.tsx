import { Suspense } from 'react';
import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { filtersFromQueryString, filtersToSearchParams } from '@commise/features-recipes';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

export const dynamic = 'force-dynamic';

/** Next's per-segment `searchParams` shape: each key is a single value, repeated values, or absent. */
type RawSearchParams = Record<string, string | readonly string[] | undefined>;

/**
 * Rebuild a `?`-less query string from Next's parsed `searchParams` (via {@link URLSearchParams}, so a
 * repeated param round-trips as repeated entries — mirrors the client's own `useSearchParams().toString()`
 * that {@link RecipeDiscoveryContainer} reads). Pure.
 *
 * @param searchParams - The request's parsed search params.
 * @returns The equivalent query string, without a leading `?`.
 */
function toQueryString(searchParams: RawSearchParams): string {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(searchParams)) {
        for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            params.append(key, entry);
        }
    }

    return params.toString();
}

/**
 * Public-discovery route (`/[locale]/discover`). A thin server page: it enforces auth (cloning a public
 * recipe into the caller's collection requires an authenticated user) and hands the locale to the client
 * {@link RecipeDiscoveryContainer}, which owns the search + clone data flow. Route protection is at the
 * resource, per the app's middleware ADR.
 *
 * B19 — SSR prefetch + `HydrationBoundary`: a server `QueryClient` prefetches the SAME query the container's
 * `useInfiniteSearchRecipes(...)` reads — the P5 `recipeQueries(client).searchInfinite(params)` factory,
 * with `params` rebuilt from THIS request's own `searchParams` via the SAME pure filter model
 * (`filtersFromQueryString` + `filtersToSearchParams`) the container derives its URL-sourced criteria from,
 * plus the container's initial `sortBy` (`RecipeSearchSortBy.RELEVANCE` — a view preference the container
 * only ever starts at on mount, never URL-sourced). This is an INFINITE query (W4/S4 "Load more"), so this
 * uses `prefetchInfiniteQuery` (not `prefetchQuery`) — a flat prefetch would dehydrate a bare page body under
 * a key the infinite observer expects `{ pages, pageParams }` for. A failed prefetch dehydrates to an empty
 * state (`prefetchInfiniteQuery` never throws; `dehydrate()` drops non-`success` queries), so the container's
 * own client-side search fetch takes over — never a 500.
 */
export default async function DiscoverPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<RawSearchParams>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const { filters, query } = filtersFromQueryString(toQueryString(await searchParams));

    const queryClient = new QueryClient();
    const client = new RecipeServiceClient({
        baseUrl: RECIPE_SERVICE_BASE_URL,
        token: (await getToken()) ?? '',
    });

    await queryClient.prefetchInfiniteQuery(
        recipeQueries(client).searchInfinite({
            ...filtersToSearchParams(filters, query),
            sortBy: RecipeSearchSortBy.RELEVANCE,
        }),
    );

    // The container reads the search criteria from the URL via `useSearchParams()`, which requires a Suspense
    // boundary during pre-render.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <Suspense>
                <RecipeDiscoveryContainer locale={locale} />
            </Suspense>
        </HydrationBoundary>
    );
}
