'use client';

/**
 * @module components/app/AppShell — the app-wide navigation shell (web; W1/L9, FR-044/FR-046).
 *
 * Wraps an authenticated surface in the shared {@link HomeChrome}: the desktop left sidebar, the sticky top
 * bar, and — below the `lg` breakpoint — the bottom tab bar + hamburger drawer. Every authenticated route
 * (Home, the recipe list, …) renders inside this ONE shell so the navigation is consistent across the app
 * instead of living only on Home; each surface passes its own `activeId` for the active destination.
 *
 * `liveCapabilities` is the set of deployed backend capabilities — an app-wide fact, not a per-page one — so
 * it is owned here once and reused by every surface (and by Home's widget curation). The responsive cutover
 * is the shared `lg` token (see HomeSidebar / HomeTabBar): sidebar at desktop widths, bottom nav at tablet +
 * mobile widths.
 *
 * **The top bar names the SURFACE, resolved here from a `titleId`.** It used to render one hard-coded 'Home'
 * for all 15 shell-hosted routes. A route passes a {@link ShellSurfaceId} rather than a resolved string
 * because those routes are SERVER components with no locale context while this shell (a client component)
 * already has it — and an id-keyed copy record makes a surface without a title a COMPILE error instead of a
 * blank bar. `titleId` is optional and defaults to Home, so a caller that says nothing behaves exactly as
 * before. See `components/app/shellSurfaces.ts` for why surfaces are a separate axis from nav destinations.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import type { HomeNavItemId } from '@commise/features-core';
import type { FC, ReactNode } from 'react';

import { DEFAULT_SHELL_SURFACE_ID, type ShellSurfaceId } from '@/components/app/shellSurfaces';
import { HomeChrome } from '@/components/home/chrome/HomeChrome';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

/**
 * The backend capabilities this app has actually deployed. Gates which nav destinations are reachable — the
 * unshipped roadmap surfaces (meal-plan / grocery / nutrition) stay gated everywhere. One source of truth,
 * consumed by the shell nav AND by Home's widget curation.
 */
export const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];

/** Props for {@link AppShell}. */
export interface AppShellProps {
    /** The active nav destination for this surface (e.g. `'home'`, `'recipes'`). */
    readonly activeId: HomeNavItemId;
    /**
     * Which surface the top bar names. Defaults to `'home'` — the value the bar hard-coded before it became
     * per-surface — so an un-migrated caller renders exactly what it did before.
     */
    readonly titleId?: ShellSurfaceId;
    /** The surface content rendered in the shell's `<main>` landmark. */
    readonly children: ReactNode;
}

/**
 * The authenticated app shell. Resolves the chrome copy, the surface title, the active locale, and the viewer
 * name, then renders {@link HomeChrome} around `children`.
 *
 * @param props - The active destination id, the surface title id, and the surface content.
 * @returns The surface wrapped in the shared navigation chrome.
 */
export const AppShell: FC<AppShellProps> = ({ activeId, titleId = DEFAULT_SHELL_SURFACE_ID, children }) => {
    const { home } = useMessages(webMessages);
    const locale = useLocale();
    const displayName = useUserProfile().data?.user.displayName;

    return (
        <HomeChrome
            chrome={home.chrome}
            pageTitle={home.chrome.pageTitles[titleId]}
            locale={locale}
            liveCapabilities={LIVE_CAPABILITIES}
            activeId={activeId}
            displayName={displayName}
        >
            {children}
        </HomeChrome>
    );
};
