import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { RecipeVersionsContainer } from '@/components/recipes/RecipeVersionsContainer';
import { isRecipeRouteId } from '@/lib/recipeRouteId';

export const dynamic = 'force-dynamic';

/**
 * Recipe version-history route (`/[locale]/recipes/[id]/versions`). A thin server page: it enforces auth
 * (these are the caller's private recipe versions) and hands the recipe id to the client
 * {@link RecipeVersionsContainer}, which fetches the version history + current version and renders the list
 * (or a localized loading / error affordance). Route protection is at the resource, per the middleware ADR.
 *
 * L9: renders inside the shared {@link AppShell} with `recipes` active, so version history keeps the app's nav
 * chrome on both desktop and narrow viewports.
 */
export default async function RecipeVersionsPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;

    // Before auth and any request: a segment that is not a recipe id names nothing (the middleware has already
    // answered it with the 404 — this keeps the page from ever asking the service about one).
    if (!isRecipeRouteId(id)) {
        notFound();
    }

    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return (
        <AppShell activeId="recipes" titleId="recipeVersions">
            <RecipeVersionsContainer recipeId={id} />
        </AppShell>
    );
}
