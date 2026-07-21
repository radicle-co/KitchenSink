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
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import type { HomeNavItemId } from '@commise/features-core';
import type { FC, ReactNode } from 'react';

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
    /** The surface content rendered in the shell's `<main>` landmark. */
    readonly children: ReactNode;
}

/**
 * The authenticated app shell. Resolves the chrome copy, active locale, and viewer name, then renders
 * {@link HomeChrome} around `children`.
 *
 * @param props - The active destination id and the surface content.
 * @returns The surface wrapped in the shared navigation chrome.
 */
export const AppShell: FC<AppShellProps> = ({ activeId, children }) => {
    const { home } = useMessages(webMessages);
    const locale = useLocale();
    const displayName = useUserProfile().data?.user.displayName;

    return (
        <HomeChrome
            chrome={home.chrome}
            locale={locale}
            liveCapabilities={LIVE_CAPABILITIES}
            activeId={activeId}
            displayName={displayName}
        >
            {children}
        </HomeChrome>
    );
};
