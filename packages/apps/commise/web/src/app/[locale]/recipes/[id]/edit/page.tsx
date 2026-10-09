import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { RecipeEditorContainer } from '@/components/recipes/RecipeEditorContainer';
import { isRecipeRouteId } from '@/lib/recipeRouteId';

export const dynamic = 'force-dynamic';

/**
 * Recipe-edit route (`/[locale]/recipes/[id]/edit`). A thin server page: it enforces auth and hands the
 * locale + recipe id to the client {@link RecipeEditorContainer} — the one-page editor (slice 7), which
 * loads the recipe and its device draft and saves the edit. Route protection is at the resource, per the app's middleware ADR.
 *
 * L9: renders inside the shared {@link AppShell} with `recipes` active, so the editor keeps the app's nav
 * chrome on both desktop and narrow viewports.
 */
export default async function EditRecipePage({
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
        // `focusedTask`: the editor is a focused task — the tab bar hides and the editor's own header and action bar
        // hold the edges (build spec §7.1) — see `HomeChromeProps.focusedTask`.
        <AppShell activeId="recipes" titleId="recipeEdit" focusedTask>
            <RecipeEditorContainer locale={locale} recipeId={id} />
        </AppShell>
    );
}
