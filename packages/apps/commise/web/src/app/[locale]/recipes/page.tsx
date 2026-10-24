import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { requireSignedIn } from '@/lib/requireSignedIn';
import { AppShell } from '@/components/app/AppShell';
import { ShellBackToTop } from '@/components/app/ShellBackToTop';
import { ProfileAvatarEntry } from '@/components/home/chrome/ProfileAvatarEntry';
import { RecipeDeletedNotice } from '@/components/recipes/RecipeDeletedNotice';
import { RecipeListContainer } from '@/components/recipes/RecipeListContainer';
import { prefetchUserSettings } from '@/lib/prefetchUserSettings';
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
 *
 * The cook's list/grid choice (an account setting, ADR-0059) is prefetched into the SAME boundary under the settings
 * key (`prefetchUserSettings`), in parallel with the library, so the server renders the cook's view.
 */
export default async function RecipesPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { getToken } = await requireSignedIn(locale, `/${locale}/recipes`);

    const queryClient = new QueryClient();
    const token = await getToken();
    const client = new RecipeServiceClient({
        baseUrl: RECIPE_SERVICE_BASE_URL,
        token: token ?? '',
    });

    await Promise.all([
        // The whole library (A11), in its default order — the read the container's boundary checks for.
        queryClient.prefetchInfiniteQuery(recipeQueries(client).library({ sortBy: 'updatedAt' })),
        // The cook's list/grid choice is an account setting: read here so the server renders it and hydration does not
        // flip the view. In parallel with the library, so it adds no latency; a failure leaves the width's default.
        prefetchUserSettings(queryClient, token),
    ]);

    // L9: the list renders inside the shared app nav shell (sidebar on desktop, bottom nav on narrow) with
    // its own active destination — the same chrome Home uses, so navigation is consistent across the app.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes" titleId="recipes">
                <RecipeListContainer locale={locale} avatar={<ProfileAvatarEntry />} />
                {/* A delete lands here and is said here: the detail page's own snackbar went with it (owner 2026-10-13). */}
                <RecipeDeletedNotice />
                {/* A long list with a floating create button: "Back to top" sits above it, last in DOM order (§3.6). */}
                <ShellBackToTop aboveFab />
            </AppShell>
        </HydrationBoundary>
    );
}
