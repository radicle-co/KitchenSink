'use client';

/**
 * @module home/chrome/HomeChrome — the Home app shell (web; US-000 / FR-046).
 *
 * Assembles the four renderings of the Home navigation into the mockup's layout: the desktop
 * {@link HomeSidebar}, the sticky {@link HomeTopBar}, the mobile {@link HomeTabBar}, and the hamburger-driven
 * {@link HomeMobileNav} drawer — with the surface content (`children`) in the `<main>` landmark between them.
 *
 * It owns only the two pieces of ephemeral chrome state — whether the desktop rail is collapsed and whether
 * the mobile drawer is open — because they are pure view state with no home for them elsewhere. Everything
 * that decides WHAT the nav shows (destinations, reachability, active id) is derived from props, so the shell
 * has no product knowledge of its own to drift.
 *
 * ⚠️ That makes it PRESENTATIONAL, and it is worth saying because the pair above it splits the other way:
 * `AppShell` — one component up, same "shell" vocabulary — reads the signed-in profile and sits on the far
 * side of the line. That line is exactly the `useUserProfile()` call, which lives there and must not move
 * here.
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
    /** The localized title of the surface in the shell, shown in the top bar (plain text, never a heading). */
    readonly pageTitle: string;
    /** The active locale segment. */
    readonly locale: string;
    /** Capabilities whose backing service is live — the single fact that drives nav reachability. */
    readonly liveCapabilities: readonly string[];
    /** The active destination for this surface. */
    readonly activeId: HomeNavItemId;
    /** The viewer's display name, if known — the source of the avatar initials. */
    readonly displayName: string | undefined;
    /** The surface content rendered inside the `<main>` landmark. */
    /**
     * Whether this surface OWNS the bottom edge — a focused task with its own pinned action bar.
     *
     * ⛔ THE TAB BAR AND A PINNED ACTION BAR CANNOT SHARE THE FOOT. Both are `fixed bottom-0`, so on the
     * recipe wizard the tab bar painted over Prev, Save Draft and Next at every width below `lg` and create
     * and edit could not be completed on phone or tablet web at all.
     *
     * ⚠️ SUPPRESSED RATHER THAN RESTACKED, and that is the product decision behind the z-index one: a
     * destination change mid-creation discards unsaved work, so offering it from under the task's own
     * controls is the wrong affordance even when it is reachable. The wizard's own `z-60` is the belt
     * against a FUTURE pinned surface; this is the braces for the one that exists.
     */
    readonly focusedTask?: boolean;

    readonly children: ReactNode;
}

/**
 * The Home application shell.
 *
 * @param props - The chrome copy, the surface title, locale, live capabilities, active id, viewer display
 * name, and the main surface content.
 * @returns The full Home chrome with `children` in the main landmark.
 */
export function HomeChrome({
    chrome,
    pageTitle,
    locale,
    liveCapabilities,
    activeId,
    displayName,
    focusedTask = false,
    children,
}: HomeChromeProps): JSX.Element {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    return (
        // The shell is TRANSPARENT so the `body` beach-glow canvas shows through (issue #145). It used to
        // hand-spell its own three-stop `bg-gradient-to-br` ramp — a second definition of the canvas that had
        // already drifted from `@commise/ui`'s `gradient.hero` (mid/end tints #F5F8FA and #EDF5F8 against the
        // wireframes' own #F0F7F4 and #E8F4F8) and covered only shell-hosted routes, leaving auth flat. Do not
        // reintroduce a background here: one canvas, one definition, in the token layer.
        //
        // Tailwind v4 scans this file as TEXT, comments included, so the replaced classes are DESCRIBED rather
        // than written out — spelling one verbatim regenerates the utility it warns about.
        <div className="flex min-h-screen">
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
                    pageTitle={pageTitle}
                    locale={locale}
                    displayName={displayName}
                    onOpenNav={() => setMobileNavOpen(true)}
                />

                {/* The foot clears the fixed bottom tab bar (`5rem`) PLUS the device safe-area inset, and
                    collapses to `lg:pb-6` once the tab bar becomes a desktop sidebar at the shared
                    desktop-vs-narrow cutover. `env(...)` is 0 in a normal viewport, so the base stays 5rem
                    (identical to the former `pb-20`) and desktop is unchanged. */}
                <main
                    className={
                        focusedTask
                            ? // The task's own bar owns the foot, so `main` clears THAT instead — same
                              // reservation, different owner. Without this the last field sits under it.
                              'flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-6 lg:pb-6'
                            : 'flex-1 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-6 md:px-6 lg:pb-6'
                    }
                >
                    {children}
                </main>
            </div>

            {!focusedTask && (
                <HomeTabBar chrome={chrome} locale={locale} liveCapabilities={liveCapabilities} activeId={activeId} />
            )}

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
