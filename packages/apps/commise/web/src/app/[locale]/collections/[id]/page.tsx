import type { Route } from 'next';
import { VIEW_MODE_KEY, viewModeFrom } from '@commise/features-recipes';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

export const dynamic = 'force-dynamic';

/**
 * Collection-detail route (`/[locale]/collections/[id]`). A thin server page: it enforces auth and hands the
 * collection id + locale to the client {@link CollectionDetailContainer}, which fetches the collection and
 * renders the detail view (or a localized loading / not-found / error affordance).
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
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    // The cook's list/grid choice (shared with My recipes), so the server renders it and hydration does not flip the view.
    const storedViewMode = viewModeFrom((await cookies()).get(VIEW_MODE_KEY)?.value);

    return (
        <AppShell activeId="recipes" titleId="collectionDetail">
            <CollectionDetailContainer
                id={id}
                locale={locale}
                {...(storedViewMode === undefined ? {} : { storedViewMode })}
            />
        </AppShell>
    );
}
