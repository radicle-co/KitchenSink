import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { RecipeServiceClient, collectionQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { AppShell } from '@/components/app/AppShell';
import { CollectionListContainer } from '@/components/recipes/CollectionListContainer';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

export const dynamic = 'force-dynamic';

/**
 * Collection-list route (`/[locale]/collections`). A thin server page: it enforces auth (these are the
 * caller's private collections) and hands the locale to the client {@link CollectionListContainer}, which
 * owns the data fetching. Route protection is at the resource, per the app's middleware ADR.
 *
 * B19 — SSR prefetch + `HydrationBoundary`: a server `QueryClient` prefetches the SAME query the container's
 * `useCollectionsInfinite()` reads. The container is an INFINITE query (W5/C7 "Load more"), so this uses
 * `prefetchInfiniteQuery` (not `prefetchQuery`) over the P5 `collectionQueries(client).listInfinite({})`
 * factory — a flat `prefetchQuery` would dehydrate a bare page body under the same key an infinite observer
 * expects `{ pages, pageParams }` for, breaking `query.data?.pages.flatMap(...)` on hydration. Authenticated
 * with THIS request's own Clerk session token (`auth().getToken()`, the `profile/page.tsx` pattern). A
 * failed prefetch dehydrates to an empty state (`prefetchInfiniteQuery` never throws; `dehydrate()` drops
 * non-`success` queries), so the container's own client-side fetch takes over — never a 500.
 */
export default async function CollectionsPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const queryClient = new QueryClient();
    const client = new RecipeServiceClient({
        baseUrl: RECIPE_SERVICE_BASE_URL,
        token: (await getToken()) ?? '',
    });

    await queryClient.prefetchInfiniteQuery(collectionQueries(client).listInfinite());

    // L9: collections render inside the shared app nav shell. Collections are a recipe-domain surface, so
    // `recipes` is the active destination (the shared nav model has no separate collections entry).
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes" titleId="collections">
                <CollectionListContainer locale={locale} />
            </AppShell>
        </HydrationBoundary>
    );
}
