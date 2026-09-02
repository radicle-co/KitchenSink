import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { ParsePasteContainer } from '@/components/recipes/ParsePasteContainer';

export const dynamic = 'force-dynamic';

/**
 * Ingredient-paste route (`/[locale]/recipes/parse`). A thin server page: it enforces auth (a parse job is
 * owned by its creator and a stranger's poll answers `404`) and hands the locale to the client
 * {@link ParsePasteContainer}, which owns the text and the create mutation. Route protection is at the
 * resource, per the app's middleware ADR.
 *
 * L9: renders inside the shared {@link AppShell} with `recipes` as the active destination, so the surface
 * keeps the sidebar on desktop and the bottom tab bar on narrow viewports.
 */
export default async function ParseIngredientsPage({
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
        <AppShell activeId="recipes" titleId="recipeParse">
            <ParsePasteContainer locale={locale} />
        </AppShell>
    );
}
