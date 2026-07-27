import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { AppShell } from '@/components/app/AppShell';
import { RecipeDetailContainer } from '@/components/recipes/RecipeDetailContainer';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

export const dynamic = 'force-dynamic';

/**
 * Recipe-detail route (`/[locale]/recipes/[id]`). A thin server page: it enforces auth and hands the
 * recipe id to the client {@link RecipeDetailContainer}, which fetches the recipe and renders the detail
 * view (or a localized loading / not-found / error affordance).
 *
 * B19 — SSR prefetch + `HydrationBoundary`: a server `QueryClient` prefetches the SAME query the container's
 * `useRecipe(id)` reads (the P5 `recipeQueries(client).detail(id)` factory), authenticated with THIS
 * request's own Clerk session token (`auth().getToken()`, the `profile/page.tsx` pattern) so a private
 * recipe the caller owns resolves during SSR. A failed prefetch (offline API, a recipe the token can't read,
 * …) dehydrates to an empty state (`prefetchQuery` never throws; `dehydrate()` drops non-`success` queries)
 * and the container's own not-found/error affordances take over on the client-side refetch — never a 500.
 */
export default async function RecipeDetailPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const queryClient = new QueryClient();
    const client = new RecipeServiceClient({
        baseUrl: RECIPE_SERVICE_BASE_URL,
        token: (await getToken()) ?? '',
    });

    await queryClient.prefetchQuery(recipeQueries(client).detail(id));

    // L9: the detail surface renders inside the shared app nav shell with `recipes` active — on mobile web,
    // opening a recipe previously removed the bottom tab bar entirely.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes" titleId="recipeDetail">
                <RecipeDetailContainer id={id} />
            </AppShell>
        </HydrationBoundary>
    );
}
