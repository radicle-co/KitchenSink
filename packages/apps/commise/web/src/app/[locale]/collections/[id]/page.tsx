import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { requireSignedIn } from '@/lib/requireSignedIn';
import { AppShell } from '@/components/app/AppShell';
import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';
import { prefetchUserSettings } from '@/lib/prefetchUserSettings';

export const dynamic = 'force-dynamic';

/**
 * Collection-detail route (`/[locale]/collections/[id]`). A thin server page: it enforces auth and hands the
 * collection id + locale to the client {@link CollectionDetailContainer}, which fetches the collection and
 * renders the detail view (or a localized loading / not-found / error affordance).
 *
 * The collection is NOT prefetched (its read is hydration-gated on the client). What IS read here is the cook's
 * list/grid choice — an account setting shared with My recipes (ADR-0059) — through `prefetchUserSettings`, so the
 * choice is in the client cache before the collection resolves and the members never draw in the width's default view
 * first. A failed read dehydrates to nothing and the view follows the width.
 *
 * L9: renders inside the shared {@link AppShell} with `recipes` active — collections are a recipe-domain
 * surface, and the shared nav model has no separate collections destination.
 */
export default async function CollectionDetailPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { getToken } = await requireSignedIn(locale, `/${locale}/collections/${encodeURIComponent(id)}`);

    const queryClient = new QueryClient();

    await prefetchUserSettings(queryClient, await getToken());

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <AppShell activeId="recipes" titleId="collectionDetail">
                <CollectionDetailContainer id={id} locale={locale} />
            </AppShell>
        </HydrationBoundary>
    );
}
