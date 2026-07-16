'use client';

/**
 * @module home/chrome/HomeMobileNav — the mobile navigation drawer (web; US-000 / FR-046).
 *
 * The slide-over the top-bar hamburger opens below the `md` breakpoint. The bottom tab bar carries the
 * primary mobile nav as compact icons; this drawer is the fuller rendering — the same destinations with
 * their text labels and the product wordmark, and the "coming soon" context that the icon-only tab bar
 * cannot show. It renders the SAME shared nav model, so it cannot drift from the sidebar or the tab bar.
 *
 * A11y: it is a labelled dialog. It closes on the backdrop, on the close control, and on Escape, and focus
 * moves to the close control on open — so a keyboard or screen-reader user can open it, read the nav, and
 * dismiss it without a trap.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import Link from 'next/link';
import { useEffect, useRef, type JSX } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { HomeIcon } from './icons';
import { homeNavHref } from './navHref';

/** The chrome copy slice this drawer renders. */
type ChromeMessages = WebMessages['home']['chrome'];

/** Props for {@link HomeMobileNav}. */
export interface HomeMobileNavProps {
    /** Whether the drawer is open. */
    readonly open: boolean;
    /** Close the drawer. */
    readonly onClose: () => void;
    /** The chrome copy (labels + accessible names), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /** The active locale segment, for building destination routes. */
    readonly locale: string;
    /** Capabilities whose backing service is live — decides reachability. */
    readonly liveCapabilities: readonly string[];
    /** The currently active destination — marked `aria-current`. */
    readonly activeId: HomeNavItemId;
}

/**
 * The mobile navigation drawer.
 *
 * @param props - Open state + close handler, the chrome copy, locale, live capabilities, and active id.
 * @returns The drawer when open, otherwise nothing.
 */
export function HomeMobileNav({
    open,
    onClose,
    chrome,
    locale,
    liveCapabilities,
    activeId,
}: HomeMobileNavProps): JSX.Element | null {
    const closeRef = useRef<HTMLButtonElement>(null);

    // Move focus into the drawer on open (so keyboard users land inside it), and close on Escape. The effect
    // is a no-op while closed, so nothing runs until the drawer is actually shown.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        closeRef.current?.focus();

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', onKeyDown);

        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    const destinations = resolveHomeNav(liveCapabilities);

    return (
        <div className="fixed inset-0 z-50 md:hidden">
            {/* The scrim. A button (not a bare div) so it is a real, labelled dismiss affordance. */}
            <button
                type="button"
                aria-label={chrome.closeNav}
                onClick={onClose}
                className="absolute inset-0 bg-charcoal/30 backdrop-blur-[2px]"
            />

            <div
                role="dialog"
                aria-label={chrome.primaryNavLabel}
                className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-white/20 bg-gradient-to-b from-[#F5F8FA] to-[#EDF5F8] shadow-[var(--shadow-xl)]"
            >
                <div className="flex items-center justify-between p-6">
                    <span className="font-display text-xl font-bold text-charcoal">{chrome.wordmark}</span>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label={chrome.closeNav}
                        className="rounded-full p-1 text-slate transition-colors hover:text-charcoal"
                    >
                        <HomeIcon name="collapse-left" className="size-6" />
                    </button>
                </div>

                <nav aria-label={chrome.primaryNavLabel} className="flex-1 space-y-1 px-3">
                    {destinations.map((item) => {
                        const label = chrome.destinations[item.id];
                        const isActive = item.id === activeId;

                        if (!item.reachable) {
                            return (
                                <span
                                    key={item.id}
                                    role="link"
                                    aria-disabled="true"
                                    aria-label={`${label}, ${chrome.comingSoonSuffix}`}
                                    className="flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 text-slate/60"
                                >
                                    <HomeIcon name={item.id} className="size-6 shrink-0" />
                                    <span className="font-medium">{label}</span>
                                </span>
                            );
                        }

                        return (
                            <Link
                                key={item.id}
                                href={homeNavHref(item.id, locale) ?? (`/${locale}` as never)}
                                aria-current={isActive ? 'page' : undefined}
                                onClick={onClose}
                                className={`flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 transition-colors ${
                                    isActive
                                        ? 'bg-gradient-to-r from-seafoam/[0.12] to-seafoam/[0.08] text-seafoam'
                                        : 'text-slate hover:bg-white/40 hover:text-charcoal'
                                }`}
                            >
                                <HomeIcon name={item.id} className="size-6 shrink-0" />
                                <span className="font-medium">{label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </div>
        </div>
    );
}
