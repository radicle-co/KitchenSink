import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { AppShell } from '@/components/app/AppShell';
import { CookingModeContainer } from '@/components/recipes/CookingModeContainer';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

export const dynamic = 'force-dynamic';

/**
 * Cooking Mode route (`/[locale]/recipes/[id]/cook`, feature 008 / T-011). A thin server page, shaped
 * exactly like its `edit` and `versions` siblings: it enforces the same auth gate every recipe surface
 * uses and hands the recipe id to the client {@link CookingModeContainer}, which drives
 * `CookingModeScreen` from the recipe-detail query.
 *
 * **Cooking Mode is a recipe SURFACE, not a destination of its own** — hence the nesting under
 * `recipes/[id]`, which also keeps the `[locale]` segment the whole app is keyed on.
 *
 * **No new endpoint, and no new call.** The steps and ingredients Cooking Mode needs are already in the
 * EXISTING `GET /api/v1/recipes/{id}` detail payload (plan.md §3), so this page prefetches the SAME P5
 * query the recipe-detail page prefetches and the container's `useRecipe(id)` reads
 * (`recipeQueries(client).detail(id)`), authenticated with this request's own Clerk session token. A cook
 * arriving from the recipe detail therefore starts on step one with no second round trip, and a failed
 * prefetch dehydrates to an empty state (`prefetchQuery` never throws; `dehydrate()` drops non-`success`
 * queries) so the screen's own error surface — with its retry — takes over on the client refetch.
 */
export default async function RecipeCookingPage({
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

    // L9: like every other authenticated surface, Cooking Mode renders inside the ONE app nav shell with
    // `recipes` active — a cook who backs out of the session must never land somewhere with no way home.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes" titleId="recipeCooking">
                <CookingModeContainer recipeId={id} />
            </AppShell>
        </HydrationBoundary>
    );
}
