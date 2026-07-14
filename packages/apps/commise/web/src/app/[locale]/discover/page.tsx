import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

export const dynamic = 'force-dynamic';

/**
 * Public-discovery route (`/[locale]/discover`). A thin server page: it enforces auth (cloning a public
 * recipe into the caller's collection requires an authenticated user) and hands the locale to the client
 * {@link RecipeDiscoveryContainer}, which owns the search + clone data flow. Route protection is at the
 * resource, per the app's middleware ADR.
 */
export default async function DiscoverPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <RecipeDiscoveryContainer locale={locale} />;
}
