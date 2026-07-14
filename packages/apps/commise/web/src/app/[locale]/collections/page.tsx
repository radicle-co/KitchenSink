import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { CollectionListContainer } from '@/components/recipes/CollectionListContainer';

export const dynamic = 'force-dynamic';

/**
 * Collection-list route (`/[locale]/collections`). A thin server page: it enforces auth (these are the
 * caller's private collections) and hands the locale to the client {@link CollectionListContainer}, which
 * owns the data fetching. Route protection is at the resource, per the app's middleware ADR.
 */
export default async function CollectionsPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <CollectionListContainer locale={locale} />;
}
