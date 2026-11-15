import { notFound } from 'next/navigation';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { requireSignedIn } from '@/lib/requireSignedIn';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';
import { isRecipeRouteId } from '@/lib/recipeRouteId';

import { CookingRoute } from './CookingRoute';

export const dynamic = 'force-dynamic';

/**
 * Cooking mode's route (`/[locale]/recipes/[id]/cook`). Full screen, outside AppShell:
 * cooking mode is a focused task, with no tab bar or sidebar.
 *
 * A thin server page, as the recipe page is: it refuses a segment that is not a recipe id, requires a signed-in cook
 * (R-14, carrying this path back through sign-in), and prefetches the SAME `recipeQueries(client).detail(id)` the recipe
 * page does, with this request's own session token. A failed prefetch dehydrates nothing and never throws, so the browser
 * reads after hydration. Where the link goes (a draft's owner to the editor) is decided in the browser
 * when the read settles, in one place, not on the server.
 */
export default async function CookingPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;

    // Before auth and any request: a segment that is not a recipe id names nothing.
    if (!isRecipeRouteId(id)) {
        notFound();
    }

    const { getToken } = await requireSignedIn(locale, `/${locale}/recipes/${encodeURIComponent(id)}/cook`);

    const queryClient = new QueryClient();
    const client = new RecipeServiceClient({ baseUrl: RECIPE_SERVICE_BASE_URL, token: (await getToken()) ?? '' });

    await queryClient.prefetchQuery(recipeQueries(client).detail(id));

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <CookingRoute id={id} />
        </HydrationBoundary>
    );
}
