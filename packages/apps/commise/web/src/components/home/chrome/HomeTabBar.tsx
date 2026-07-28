'use client';

/**
 * @module home/chrome/HomeTabBar — the mobile bottom tab bar (web; US-000 / FR-046).
 *
 * The fixed bottom navigation from the mockup, shown only below the `lg` breakpoint (the desktop sidebar
 * takes over above it). It is the COMPACT rendering of the same shared nav model the sidebar renders — icon
 * over a short label — so the two can never list different destinations.
 *
 * Gated destinations render exactly as they do in the sidebar: non-interactive, `aria-disabled`, with a
 * "coming soon" accessible name — never a tab that navigates to a 404.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import Link from 'next/link';
import type { JSX } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { HomeIcon } from './icons';
import { homeNavHref } from './navHref';

/** The chrome copy slice this bar renders. */
type ChromeMessages = WebMessages['home']['chrome'];

/** Props for {@link HomeTabBar}. */
export interface HomeTabBarProps {
    /** The chrome copy (labels + accessible names), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /** The active locale segment, for building destination routes. */
    readonly locale: string;
    /** Capabilities whose backing service is live — decides which tabs are reachable. */
    readonly liveCapabilities: readonly string[];
    /** The currently active destination (Home, for this surface) — marked `aria-current`. */
    readonly activeId: HomeNavItemId;
}

/**
 * The mobile bottom tab bar.
 *
 * @param props - The chrome copy, locale, live capabilities, and active destination.
 * @returns The fixed bottom navigation (hidden at `lg`+).
 */
export function HomeTabBar({ chrome, locale, liveCapabilities, activeId }: HomeTabBarProps): JSX.Element {
    const destinations = resolveHomeNav(liveCapabilities);

    return (
        <nav
            aria-label={chrome.tabNavLabel}
            // The bar grows by the device's bottom safe-area inset and pads its foot by the same amount, so the
            // 64px (`4rem`) icon row sits clear ABOVE the home indicator rather than being squished under it.
            // `env(safe-area-inset-bottom)` is 0 in a normal viewport, so height stays 4rem and the browser
            // output is unchanged; the bar is `lg:hidden`, so desktop never renders it at all.
            className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-white/30 bg-gradient-to-t from-white/90 to-white/80 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-[24px] lg:hidden"
        >
            {destinations.map((item) => {
                const label = chrome.destinations[item.id];
                const isActive = item.id === activeId;

                if (!item.reachable) {
                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-disabled="true"
                            aria-label={`${label}, ${chrome.comingSoonSuffix}`}
                            className="flex flex-1 cursor-not-allowed flex-col items-center gap-1 py-2 text-slate/50"
                        >
                            <HomeIcon name={item.id} className="size-6" />
                            <span className="text-xs">{label}</span>
                        </button>
                    );
                }

                const href = homeNavHref(item.id, locale);

                return (
                    <Link
                        key={item.id}
                        href={href ?? (`/${locale}` as never)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex flex-1 flex-col items-center gap-1 py-2 ${
                            // The active colour reaches the `text-xs` LABEL as well as the glyph, so it must be a
                            // text-grade token: `ocean-dark` (see the palette JSDoc in `@commise/ui`).
                            isActive ? 'text-ocean-dark' : 'text-slate'
                        }`}
                    >
                        <HomeIcon name={item.id} className="size-6" />
                        <span className={`text-xs ${isActive ? 'font-semibold' : ''}`}>{label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
