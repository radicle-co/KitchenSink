import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { AppShell } from '@/components/app/AppShell';
import { RecipeListContainer } from '@/components/recipes/RecipeListContainer';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

export const dynamic = 'force-dynamic';

/**
 * Recipe-list route (`/[locale]/recipes`). A thin server page: it enforces auth (these are the caller's
 * private recipes) and hands the locale to the client {@link RecipeListContainer}, which owns the data
 * fetching. Route protection is at the resource, per the app's middleware ADR.
 *
 * B19 — SSR prefetch + `HydrationBoundary`: a server `QueryClient` prefetches the SAME query the container's
 * `useRecipes()` reads (the P5 `recipeQueries(client).list({})` factory — the identical `queryKey`/`queryFn`
 * as the client hook, so the hydrated cache entry IS the one the hook subscribes to, never a near-miss key).
 * The server client is built from THIS request's own Clerk session token (`auth().getToken()`, the same
 * pattern `profile/page.tsx` already proves), so the prefetch fetches the CALLER's own recipes — not a
 * generic/unauthenticated read. `prefetchQuery` never throws (TanStack Query catches the query's own error
 * internally) and `dehydrate()` only serializes `status: 'success'` queries by default, so a failed prefetch
 * (offline API, cold start, …) silently dehydrates to an EMPTY state rather than 500ing this page — the
 * client container then just runs its normal client-side fetch, exactly as it did before B19.
 */
export default async function RecipesPage({
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

    await queryClient.prefetchQuery(recipeQueries(client).list());

    // L9: the list renders inside the shared app nav shell (sidebar on desktop, bottom nav on narrow) with
    // its own active destination — the same chrome Home uses, so navigation is consistent across the app.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes">
                <RecipeListContainer locale={locale} />
            </AppShell>
        </HydrationBoundary>
    );
}
