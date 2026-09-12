import { DataSourcesScreen } from '@commise/features-recipes';
import { AppShell } from '@/components/app/AppShell';

/**
 * The `/legal/sources` route content (curated U25, design §S16), presentational: the Data sources page inside the
 * shared shell. Kept
 * out of `page.tsx` so the route segment exports only Next.js-valid fields, the `SettingsContent` pattern. The page
 * reads food-service directly through the app-wide `FoodServiceProvider` (plan 002 S5).
 *
 * ⚠️ The address is a one-way door: the attribution the licences require points here, and people bookmark it.
 */
export function SourcesContent(): React.ReactElement {
    return (
        <AppShell activeId="profile" titleId="dataSources">
            <DataSourcesScreen />
        </AppShell>
    );
}
