'use client';

/**
 * @module home/chrome/HomeSidebar — the desktop navigation sidebar (web; US-000 / FR-046).
 *
 * The glass rail from the Home mockup: logo + wordmark, the six navigation destinations, and a collapse
 * control. It is `hidden` below the `lg` breakpoint (the mobile tab bar takes over there), so it is the
 * DESKTOP rendering of the shared nav model — the tab bar is the same model rendered differently.
 *
 * ## The two decisions that matter here
 *
 * **Reachability is derived, not declared.** The destinations come from `resolveHomeNav(liveCapabilities)`;
 * a destination whose backing service is not live renders as a non-interactive, `aria-disabled` control whose
 * accessible name carries the "coming soon" suffix — NEVER a link to a route that 404s. When the service
 * ships, the same fact that reveals its Home widget makes its nav entry reachable, from one source.
 *
 * **Collapsed is a visual state, not an information state.** Collapsing hides the text labels visually, but
 * each control keeps its accessible name (the label, plus "coming soon" when gated), so a screen-reader user
 * gets the same nav whether the rail is expanded or collapsed.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import Link from 'next/link';
import type { JSX } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { HomeIcon } from './icons';
import { homeNavHref } from './navHref';

/** The chrome copy slice this sidebar renders. */
type ChromeMessages = WebMessages['home']['chrome'];

/** Props for {@link HomeSidebar}. */
export interface HomeSidebarProps {
    /** The chrome copy (labels + accessible names), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /** The active locale segment, for building destination routes. */
    readonly locale: string;
    /** Capabilities whose backing service is live — the single fact that decides reachability. */
    readonly liveCapabilities: readonly string[];
    /** The currently active destination (Home, for this surface) — marked `aria-current`. */
    readonly activeId: HomeNavItemId;
    /** Whether the rail is collapsed to icons only. */
    readonly collapsed: boolean;
    /** Toggle the collapsed state. */
    readonly onToggleCollapse: () => void;
}

/**
 * The desktop navigation sidebar.
 *
 * @param props - The chrome copy, locale, live capabilities, active destination, and collapse state/handler.
 * @returns The glass navigation rail (hidden below `lg`).
 */
export function HomeSidebar({
    chrome,
    locale,
    liveCapabilities,
    activeId,
    collapsed,
    onToggleCollapse,
}: HomeSidebarProps): JSX.Element {
    const destinations = resolveHomeNav(liveCapabilities);

    return (
        <div
            className={`hidden h-screen flex-col border-r border-white/20 bg-gradient-to-b from-white/[0.12] to-white/[0.08] backdrop-blur-[24px] transition-all duration-200 lg:flex ${
                collapsed ? 'w-20' : 'w-64'
            }`}
        >
            <div className="p-6">
                <div className="flex items-center gap-3">
                    {/* The logo mark. Decorative here — the wordmark beside it names the product; when the
                        rail is collapsed the wordmark is gone, so the mark carries the accessible name. */}
                    <span
                        aria-hidden={!collapsed}
                        aria-label={collapsed ? chrome.logoAlt : undefined}
                        role={collapsed ? 'img' : undefined}
                        className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-seafoam to-ocean-dark font-display text-lg font-bold text-white"
                    >
                        C
                    </span>
                    {!collapsed && (
                        <span className="font-display text-xl font-bold text-charcoal">{chrome.wordmark}</span>
                    )}
                </div>
            </div>

            <nav aria-label={chrome.primaryNavLabel} className="flex-1 space-y-1 px-3">
                {destinations.map((item) => {
                    const label = chrome.destinations[item.id];
                    const isActive = item.id === activeId;

                    if (!item.reachable) {
                        // Not-yet-shipped: non-interactive, but focusable and announced as "…, coming soon"
                        // (aria-disabled, not the `disabled` attribute, so keyboard users still discover it).
                        return (
                            <button
                                key={item.id}
                                type="button"
                                aria-disabled="true"
                                aria-label={`${label}, ${chrome.comingSoonSuffix}`}
                                // Contrast (WCAG 2.1 AA, #113): opaque `slate` (5.24:1). `text-slate/60` composited to
                                // 2.41:1 — the token passed while the pixel did not. Inactive is communicated by
                                // `cursor-not-allowed` + the announced "coming soon" name, not by dimming the text
                                // below legibility.
                                className="flex w-full cursor-not-allowed items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 text-left text-slate"
                            >
                                <HomeIcon name={item.id} className="size-6 shrink-0" />
                                {!collapsed && <span className="font-medium">{label}</span>}
                            </button>
                        );
                    }

                    const href = homeNavHref(item.id, locale);

                    return (
                        <Link
                            key={item.id}
                            href={href ?? (`/${locale}` as never)}
                            // Always name the link (not just via the visible span): when the rail is
                            // collapsed the label is hidden and the icon is aria-hidden, so without this the
                            // link would have no accessible name.
                            aria-label={label}
                            aria-current={isActive ? 'page' : undefined}
                            className={`flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 transition-colors ${
                                isActive
                                    ? // The rail, the gradient pill and the glyph tint stay seafoam — non-text
                                      // accents. The FOREGROUND is `ocean-dark`, because this class colours the
                                      // visible label too (see the palette JSDoc in `@commise/ui`).
                                      'border-l-[3px] border-seafoam bg-gradient-to-r from-seafoam/[0.12] to-seafoam/[0.08] text-ocean-dark'
                                    : 'text-slate hover:bg-white/10 hover:text-charcoal'
                            }`}
                        >
                            <HomeIcon name={item.id} className="size-6 shrink-0" />
                            {!collapsed && <span className="font-medium">{label}</span>}
                        </Link>
                    );
                })}
            </nav>

            <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={collapsed ? chrome.expandNav : chrome.collapseNav}
                aria-pressed={collapsed}
                className="flex items-center justify-center border-t border-white/20 p-4 text-slate transition-colors hover:text-charcoal"
            >
                <HomeIcon
                    name="collapse-left"
                    className={`size-6 transition-transform ${collapsed ? 'rotate-180' : ''}`}
                />
            </button>
        </div>
    );
}
