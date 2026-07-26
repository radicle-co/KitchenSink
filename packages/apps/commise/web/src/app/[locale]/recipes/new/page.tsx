import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { RecipeCreateContainer } from '@/components/recipes/RecipeCreateContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe-create route (`/[locale]/recipes/new`). A thin server page: it enforces auth (creating a recipe is
 * an owner action) and hands the locale to the client {@link RecipeCreateContainer}, which owns the form
 * state, ingredient resolution, and submission. Route protection is at the resource, per the app's
 * middleware ADR.
 *
 * L9: renders inside the shared {@link AppShell} — the same chrome Home and the recipe list use — with
 * `recipes` as the active destination, so the creation surface keeps the sidebar on desktop and the bottom tab
 * bar on narrow viewports instead of stranding the viewer with no navigation.
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

    return (
        <AppShell activeId="recipes">
            <RecipeCreateContainer locale={locale} />
        </AppShell>
    );
}
