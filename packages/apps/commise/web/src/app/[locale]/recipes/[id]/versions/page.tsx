import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { RecipeVersionsContainer } from '@/components/recipes/RecipeVersionsContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe version-history route (`/[locale]/recipes/[id]/versions`). A thin server page: it enforces auth
 * (these are the caller's private recipe versions) and hands the recipe id to the client
 * {@link RecipeVersionsContainer}, which fetches the version history + current version and renders the list
 * (or a localized loading / error affordance). Route protection is at the resource, per the middleware ADR.
 */
export default async function RecipeVersionsPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <RecipeVersionsContainer recipeId={id} />;
}
