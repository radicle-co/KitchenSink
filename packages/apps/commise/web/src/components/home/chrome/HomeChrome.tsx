'use client';

/**
 * @module home/chrome/HomeChrome — the web app shell's layout (`docs/design/uiOverhaul/buildSpec.md` §3.2): the
 * {@link HomeSidebar} at `nav` (840) and wider, the bottom {@link HomeTabBar} below it, and the page in the `<main>`
 * landmark between. There is no top bar and no drawer: each page's large title is its H1 (`LargeTitleHeader`).
 *
 * `<main>` is the `main` container every page queries; its gutters are padding, so a query reads the content box. Below
 * `nav` its foot reserves the tab bar plus the floating create button's 88 px, and the same reservation is the
 * document's `scroll-padding-bottom` (`globals.css`, keyed on the bar), so a focused last card is never hidden (SC
 * 2.4.11). `--bottom-chrome` — the tab bar's height, 0 from `nav` and on a focused task — is what the floating button,
 * "Back to top" and the snackbar stand on.
 *
 * The sidebar's collapse comes from `useSidebarPreference`, which holds it above every page.
 *
 * ⚠️ PRESENTATIONAL about data: the profile arrives from `AppShell`, which is where data enters the chrome.
 */
import type { HomeNavItemId } from '@commise/features-core';
import { PopupInsetsContext } from '@commise/ui/popup-insets';
import { useCallback, useState, type JSX, type ReactNode } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { HomeSidebar } from './HomeSidebar';
import { HomeTabBar } from './HomeTabBar';
import type { ProfileEntry } from '@commise/features-core';
import { useSidebarPreference } from './sidebarPreferenceContext';
import { tabBarInsets } from './tabBarInsets';

/** Props for {@link HomeChrome}. */
export interface HomeChromeProps {
    readonly chrome: WebMessages['home']['chrome'];
    readonly locale: string;
    readonly liveCapabilities: readonly string[];
    readonly activeId: HomeNavItemId | null;
    /** The profile read, for the sidebar's profile row. */
    readonly profile: ProfileEntry;
    /** The sidebar's New recipe control, for each of its two widths. */
    readonly newRecipe: (collapsed: boolean) => ReactNode;
    /**
     * Whether this page OWNS the bottom edge: a focused task with its own pinned action bar (the recipe wizard). The tab
     * bar and a pinned action bar cannot share the foot, and leaving a task mid-way from under its own controls is the
     * wrong affordance, so the bar is suppressed rather than restacked.
     */
    readonly focusedTask?: boolean;
    readonly children: ReactNode;
}

/**
 * The web app shell.
 *
 * @param props - The copy, locale, capabilities, active destination, profile, New recipe and the page.
 * @returns The sidebar, the page in `<main>`, and the tab bar.
 */
export function HomeChrome({
    chrome,
    locale,
    liveCapabilities,
    activeId,
    profile,
    newRecipe,
    focusedTask = false,
    children,
}: HomeChromeProps): JSX.Element {
    const { collapsed, toggle } = useSidebarPreference();
    // The laid-out tab bar, held as state by a callback ref, and the reader the design system's popups call as they
    // place themselves. A new reader only when the bar node changes.
    const [tabBar, setTabBar] = useState<HTMLElement | null>(null);
    const readInsets = useCallback(() => tabBarInsets(tabBar), [tabBar]);

    // Transparent, so the `body` canvas wash shows through (issue #145): one canvas, defined in the token layer.
    return (
        <div
            className={`flex min-h-dvh ${
                focusedTask
                    ? '[--bottom-chrome:0px]'
                    : '[--bottom-chrome:calc(4rem+env(safe-area-inset-bottom))] nav:[--bottom-chrome:0px]'
            }`}
        >
            <HomeSidebar
                chrome={chrome}
                locale={locale}
                liveCapabilities={liveCapabilities}
                activeId={activeId}
                profile={profile}
                collapsed={collapsed}
                onToggleCollapse={toggle}
                newRecipe={newRecipe(collapsed)}
            />

            <main
                className={`@container/main min-w-0 flex-1 px-4 pt-6 medium:px-6 nav:px-8 nav:pb-8 ${
                    focusedTask
                        ? // The task's own bar owns the foot, so `main` clears that instead.
                          'pb-[calc(6rem+env(safe-area-inset-bottom))]'
                        : 'pb-[calc(var(--bottom-chrome)+6.5rem)]'
                }`}
            >
                <PopupInsetsContext value={readInsets}>{children}</PopupInsetsContext>
            </main>

            {focusedTask ? null : (
                <HomeTabBar
                    ref={setTabBar}
                    chrome={chrome}
                    locale={locale}
                    liveCapabilities={liveCapabilities}
                    activeId={activeId}
                />
            )}
        </div>
    );
}
