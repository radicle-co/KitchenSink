import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { RecipeEditorContainer } from '@/components/recipes/RecipeEditorContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe-create route (`/[locale]/recipes/new`). A thin server page: it enforces auth (creating a recipe is
 * an owner action) and hands the locale to the client {@link RecipeEditorContainer} — the one-page editor (slice 7),
 * which owns the draft, its saving and its publication. Route protection is at the resource, per the app's
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
        // `focusedTask`: the editor is a focused task — the tab bar hides and the editor's own header and action bar
        // hold the edges (build spec §7.1) — see `HomeChromeProps.focusedTask`.
        <AppShell activeId="recipes" titleId="recipeNew" focusedTask>
            <RecipeEditorContainer locale={locale} />
        </AppShell>
    );
}
