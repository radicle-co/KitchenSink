import { requireSignedIn } from '@/lib/requireSignedIn';
import { AppShell } from '@/components/app/AppShell';
import { FoodPageContainer } from '@/components/foods/FoodPageContainer';

export const dynamic = 'force-dynamic';

/**
 * The author's food page (`/[locale]/foods/[foodId]`). An orchestration page, a thin server page: it enforces sign-in and hands the id and
 * locale to the client container, which reads the food and draws one of the page's twelve states. The food is not
 * prefetched: its read is the cook's own and is hydration-gated on the client.
 *
 * ⚠️ ONE-WAY DOOR: this address is linked from a refused publish and bookmarked.
 *
 * @pattern Facade — one route over the auth gate and the client container
 */
export default async function FoodPage({
    params,
}: {
    params: Promise<{ locale: string; foodId: string }>;
}): Promise<React.ReactElement> {
    const { locale, foodId } = await params;

    await requireSignedIn(locale, `/${locale}/foods/${encodeURIComponent(foodId)}`);

    return (
        <AppShell activeId={null} titleId="food">
            <FoodPageContainer foodId={foodId} locale={locale} />
        </AppShell>
    );
}
