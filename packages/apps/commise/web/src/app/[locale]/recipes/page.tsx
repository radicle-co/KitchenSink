import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { RecipeListContainer } from '@/components/recipes/RecipeListContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe-list route (`/[locale]/recipes`). A thin server page: it enforces auth (these are the caller's
 * private recipes) and hands the locale to the client {@link RecipeListContainer}, which owns the data
 * fetching. Route protection is at the resource, per the app's middleware ADR.
 */
export default async function RecipesPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <RecipeListContainer locale={locale} />;
}
