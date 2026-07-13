import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { RecipeDetailContainer } from '@/components/recipes/RecipeDetailContainer';

export const dynamic = 'force-dynamic';

/**
 * Recipe-detail route (`/[locale]/recipes/[id]`). A thin server page: it enforces auth and hands the
 * recipe id to the client {@link RecipeDetailContainer}, which fetches the recipe and renders the detail
 * view (or a localized loading / not-found / error affordance).
 */
export default async function RecipeDetailPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}): Promise<React.ReactElement> {
    const { locale, id } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <RecipeDetailContainer id={id} />;
}
