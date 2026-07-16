'use client';

/**
 * @module home/chrome/HomeChrome — the Home app shell (web; US-000 / FR-046).
 *
 * Assembles the four renderings of the Home navigation into the mockup's layout: the desktop {@link
 * HomeSidebar}, the sticky {@link HomeTopBar}, the mobile {@link HomeTabBar}, and the hamburger-driven
 * {@link HomeMobileNav} drawer — with the surface content (`children`) in the `<main>` landmark between them.
 *
 * It owns only the two pieces of ephemeral chrome state — whether the desktop rail is collapsed and whether
 * the mobile drawer is open — because they are pure view state with no home for them elsewhere. Everything
 * that decides WHAT the nav shows (destinations, reachability, active id) is derived from props, so the shell
 * has no product knowledge of its own to drift.
 */
import type { HomeNavItemId } from '@commise/features-core';
import { useState, type JSX, type ReactNode } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { HomeMobileNav } from './HomeMobileNav';
import { HomeSidebar } from './HomeSidebar';
import { HomeTabBar } from './HomeTabBar';
import { HomeTopBar } from './HomeTopBar';

/** Props for {@link HomeChrome}. */
export interface HomeChromeProps {
    /** The chrome copy, resolved for the active locale. */
    readonly chrome: WebMessages['home']['chrome'];
    /** The active locale segment. */
    readonly locale: string;
    /** Capabilities whose backing service is live — the single fact that drives nav reachability. */
    readonly liveCapabilities: readonly string[];
    /** The active destination for this surface. */
    readonly activeId: HomeNavItemId;
    /** The viewer's display name, if known — the source of the avatar initials. */
    readonly displayName: string | undefined;
    /** The surface content rendered inside the `<main>` landmark. */
    readonly children: ReactNode;
}

/**
 * The Home application shell.
 *
 * @param props - The chrome copy, locale, live capabilities, active id, viewer display name, and the main
 * surface content.
 * @returns The full Home chrome with `children` in the main landmark.
 */
export function HomeChrome({
    chrome,
    locale,
    liveCapabilities,
    activeId,
    displayName,
    children,
}: HomeChromeProps): JSX.Element {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    return (
        <div className="flex min-h-screen bg-gradient-to-br from-sand via-[#F5F8FA] to-[#EDF5F8]">
            <HomeSidebar
                chrome={chrome}
                locale={locale}
                liveCapabilities={liveCapabilities}
                activeId={activeId}
                collapsed={collapsed}
                onToggleCollapse={() => setCollapsed((value) => !value)}
            />

            <div className="flex min-w-0 flex-1 flex-col">
                <HomeTopBar
                    chrome={chrome}
                    locale={locale}
                    displayName={displayName}
                    onOpenNav={() => setMobileNavOpen(true)}
                />

                {/* pb-20 clears the fixed mobile tab bar; it collapses to pb-0 once the tab bar is hidden. */}
                <main className="flex-1 px-4 pb-20 pt-6 md:px-6 md:pb-6">{children}</main>
            </div>

            <HomeTabBar chrome={chrome} locale={locale} liveCapabilities={liveCapabilities} activeId={activeId} />

            <HomeMobileNav
                open={mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
                chrome={chrome}
                locale={locale}
                liveCapabilities={liveCapabilities}
                activeId={activeId}
            />
        </div>
    );
}
