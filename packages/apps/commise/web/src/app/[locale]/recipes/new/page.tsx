import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { RecipeCreateContainer } from '@/components/recipes/RecipeCreateContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe-create route (`/[locale]/recipes/new`). A thin server page: it enforces auth (creating a recipe is
 * an owner action) and hands the locale to the client {@link RecipeCreateContainer}, which owns the form
 * state, ingredient resolution, and submission. Route protection is at the resource, per the app's
 * middleware ADR.
 */
export default async function NewRecipePage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <RecipeCreateContainer locale={locale} />;
}
