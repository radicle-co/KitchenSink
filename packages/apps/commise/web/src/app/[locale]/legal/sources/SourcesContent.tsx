'use client';

import { profileMessages } from '@commise/features-account/profile';
import { DataSourcesScreen } from '@commise/features-recipes';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { withBasePath } from '@/lib/basePath';

/**
 * The `/legal/sources` route content (curated U25, design §S16), the Data sources page inside the shared shell.
 * Kept out of `page.tsx` so the route segment exports only Next.js-valid fields. The page reads food-service directly
 * through the app-wide `FoodServiceProvider` (plan 002 S5).
 *
 * A client component for one reason: the way back to Profile (`buildSpec.md` §9.2) is the router's, and a function
 * cannot cross from the server page. Profile is where the page is reached from, so it is where Back goes.
 *
 * ⚠️ The address is a one-way door: the attribution the licences require points here, and people bookmark it.
 */
export function SourcesContent(): React.ReactElement {
    const t = useMessages(profileMessages);
    const locale = useLocale();
    const router = useRouter();
    const profilePath = `/${locale}/profile`;

    return (
        <AppShell activeId={null} titleId="dataSources">
            <DataSourcesScreen
                back={{
                    label: t.backToProfile,
                    parent: t.title,
                    href: withBasePath(profilePath),
                    onPress: () => router.push(profilePath as Route),
                }}
            />
        </AppShell>
    );
}
