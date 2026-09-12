import { Suspense } from 'react';
import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { discoverySearchParams, filtersFromQueryString } from '@commise/features-recipes';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { AppShell } from '@/components/app/AppShell';
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
 * suspense read uses — the P5 `recipeQueries(client).searchInfinite(params)` factory, with `params` built by
 * `discoverySearchParams`, the one definition of the discovery key, from THIS request's own `searchParams` (via the
 * same `filtersFromQueryString` the container reads the URL with) plus the container's initial `sortBy`
 * (`RecipeSearchSortBy.RELEVANCE` — a view preference the container only ever starts at, never URL-sourced). The
 * container's boundary opens on the server only when this key holds data, so a successful prefetch ships the results. This is an INFINITE query (W4/S4 "Load more"), so this
 * uses `prefetchInfiniteQuery` over the INFINITE factory (not `prefetchQuery` over the flat one): the two
 * shapes key separately (`recipeServiceKeys.recipeSearchInfinite`, PR #91 review), so a flat prefetch would
 * land under a key this container never reads and hydrate nothing. A failed prefetch dehydrates to an empty
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
        recipeQueries(client).searchInfinite(
            discoverySearchParams({ filters, query, sortBy: RecipeSearchSortBy.RELEVANCE }),
        ),
    );

    // The container reads the search criteria from the URL via `useSearchParams()`, which requires a Suspense
    // boundary during pre-render.
    //
    // L9: discovery renders inside the shared app nav shell. It is a recipe-domain surface, so `recipes` is the
    // active destination (the shared nav model has no separate discovery entry). The shell sits OUTSIDE the
    // Suspense boundary, so the chrome is present while the search results stream in — never a bare fallback.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes" titleId="discover">
                <Suspense>
                    <RecipeDiscoveryContainer locale={locale} />
                </Suspense>
            </AppShell>
        </HydrationBoundary>
    );
}
