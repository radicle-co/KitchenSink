import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { CollectionFormContainer } from '@/components/recipes/CollectionFormContainer';

export const dynamic = 'force-dynamic';

/**
 * Collection-rename route (`/[locale]/collections/[id]/rename`). A thin server page: it enforces auth and
 * renders the client {@link CollectionFormContainer} in `rename` mode, which seeds the name from the loaded
 * collection and owns the update mutation. This is the navigation target of the detail view's rename action.
 */
export default async function RenameCollectionPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <CollectionFormContainer mode="rename" collectionId={id} locale={locale} />;
}
