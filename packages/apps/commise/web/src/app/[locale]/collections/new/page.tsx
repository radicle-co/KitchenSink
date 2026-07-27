import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { CollectionFormContainer } from '@/components/recipes/CollectionFormContainer';

export const dynamic = 'force-dynamic';

/**
 * Collection-create route (`/[locale]/collections/new`). A thin server page: it enforces auth and renders the
 * client {@link CollectionFormContainer} in `create` mode, which owns the controlled name field and the
 * create mutation. (Static `new` takes precedence over the dynamic `[id]` sibling in Next routing.)
 *
 * L9: renders inside the shared {@link AppShell} with `recipes` active — collections are a recipe-domain
 * surface, and the shared nav model has no separate collections destination.
 */
export default async function NewCollectionPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return (
        <AppShell activeId="recipes" titleId="collectionNew">
            <CollectionFormContainer mode="create" locale={locale} />
        </AppShell>
    );
}
