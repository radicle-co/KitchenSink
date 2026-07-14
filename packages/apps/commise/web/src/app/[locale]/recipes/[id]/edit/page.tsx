import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { RecipeEditContainer } from '@/components/recipes/RecipeEditContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe-edit route (`/[locale]/recipes/[id]/edit`). A thin server page: it enforces auth and hands the
 * locale + recipe id to the client {@link RecipeEditContainer}, which loads the recipe, seeds the form, and
 * persists the edit. Route protection is at the resource, per the app's middleware ADR.
 */
export default async function EditRecipePage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <RecipeEditContainer locale={locale} recipeId={id} />;
}
