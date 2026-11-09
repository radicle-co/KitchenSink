import { requireSignedIn } from '@/lib/requireSignedIn';
import { AppShell } from '@/components/app/AppShell';
import { YourFoodsContainer } from '@/components/foods/YourFoodsContainer';

export const dynamic = 'force-dynamic';

/** The cook’s own foods (`/[locale]/foods`), reached from Profile's "Your foods" row. */
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
