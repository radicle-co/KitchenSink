import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { CollectionRecipePickerContainer } from '@/components/recipes/CollectionRecipePickerContainer';

export const dynamic = 'force-dynamic';

/**
 * Add-a-recipe-to-collection route (`/[locale]/collections/[id]/add`). A thin server page: it enforces auth
 * and renders the client {@link CollectionRecipePickerContainer}, which lists the caller's own recipes and
 * adds them to this collection. This is the navigation target of the detail view's add-a-recipe action.
 *
 * L9: renders inside the shared {@link AppShell} with `recipes` active — collections are a recipe-domain
 * surface, and the shared nav model has no separate collections destination.
 */
export default async function AddRecipeToCollectionPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return (
        <AppShell activeId="recipes">
            <CollectionRecipePickerContainer id={id} locale={locale} />
        </AppShell>
    );
}
