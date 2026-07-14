import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

export const dynamic = 'force-dynamic';

/**
 * Collection-detail route (`/[locale]/collections/[id]`). A thin server page: it enforces auth and hands the
 * collection id + locale to the client {@link CollectionDetailContainer}, which fetches the collection and
 * renders the detail view (or a localized loading / not-found / error affordance).
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

    return <CollectionDetailContainer id={id} locale={locale} />;
}
