import { requireSignedIn } from '@/lib/requireSignedIn';
import { AppShell } from '@/components/app/AppShell';
import { YourFoodsContainer } from '@/components/foods/YourFoodsContainer';

export const dynamic = 'force-dynamic';

/**
 * The cook’s own foods (`/[locale]/foods`), reached from Profile's "Your foods" row. An orchestration page: it enforces
 * sign-in and hands the locale to the client container.
 *
 * @pattern Facade — one route over the auth gate and the client container
 */
export default async function YourFoodsPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
    const { locale } = await params;

    await requireSignedIn(locale, `/${locale}/foods`);

    return (
        <AppShell activeId={null} titleId="yourFoods">
            <YourFoodsContainer locale={locale} />
        </AppShell>
    );
}
