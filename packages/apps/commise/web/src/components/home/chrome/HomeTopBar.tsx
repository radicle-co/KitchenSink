'use client';

/**
 * @module home/chrome/HomeTopBar — the sticky Home top bar (web; US-000 / FR-046).
 *
 * The `h-14` glass bar from the mockup: a mobile nav trigger (hamburger, hidden at `md`+ where the sidebar is
 * visible), the page title, a search affordance, a notifications affordance, and the account avatar.
 *
 * ## Two deliberate departures from the mockup
 *
 * **The notification bell carries NO count.** The mockup shows a red "3" badge, but there is no notifications
 * service in Home v1 — a hard-coded "3" would be fabricated data, the same class of dishonesty the roadmap
 * skeletons forbid. The bell ships as a labelled control with no badge; the count returns when a real
 * notifications feed does.
 *
 * **The avatar shows REAL initials, or nothing invented.** Initials are derived from the viewer's actual
 * profile display name via `initialsFor`. A name-less account (email sign-up, no name set) is a real state:
 * it falls back to a person glyph, never invented initials, and its accessible name says "your account".
 */
import { initialsFor } from '@commise/features-core';
import Link from 'next/link';
import type { Route } from 'next';
import type { JSX } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { HomeIcon } from './icons';

/** The chrome copy slice this bar renders. */
type ChromeMessages = WebMessages['home']['chrome'];

/** Props for {@link HomeTopBar}. */
export interface HomeTopBarProps {
    /** The chrome copy (title + accessible names), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /** The active locale segment, for the account link route. */
    readonly locale: string;
    /** The viewer's display name, if known — the source of the avatar initials. */
    readonly displayName: string | undefined;
    /** Open the mobile navigation drawer (hamburger; only shown below `md`). */
    readonly onOpenNav: () => void;
}

/**
 * The sticky Home top bar.
 *
 * @param props - The chrome copy, locale, viewer display name, and the mobile-nav open handler.
 * @returns The sticky glass header.
 */
export function HomeTopBar({ chrome, locale, displayName, onOpenNav }: HomeTopBarProps): JSX.Element {
    const initials = initialsFor(displayName);

    return (
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/20 bg-gradient-to-r from-white/50 to-white/40 px-4 backdrop-blur-[16px]">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onOpenNav}
                    aria-label={chrome.openNav}
                    // `min-h-11 min-w-11` (44px) is an explicit mobile touch-target FLOOR, reset at `md:` to
                    // keep desktop density. It sits below the control's current ~48px computed size, so it
                    // changes no pixels today — it guards the target minimum against future icon/padding drift.
                    className="-ml-2 min-h-11 min-w-11 rounded-full p-2 text-charcoal transition-colors hover:bg-pearl md:hidden md:min-h-0 md:min-w-0"
                >
                    <HomeIcon name="menu" className="size-6" />
                </button>
                <h1 className="text-lg font-semibold text-charcoal">{chrome.pageTitle}</h1>
            </div>

            <div className="flex items-center gap-1">
                <button
                    type="button"
                    aria-label={chrome.search}
                    // 44px mobile touch-target floor, reset at md — a no-op below the ~48px control today.
                    className="min-h-11 min-w-11 rounded-full p-2 text-charcoal transition-colors hover:bg-pearl md:min-h-0 md:min-w-0"
                >
                    <HomeIcon name="search" className="size-6" />
                </button>

                {/* No count badge — there is no notifications service in v1, and a fabricated number is
                    exactly what this surface refuses to show. */}
                <button
                    type="button"
                    aria-label={chrome.notifications}
                    className="min-h-11 min-w-11 rounded-full p-2 text-charcoal transition-colors hover:bg-pearl md:min-h-0 md:min-w-0"
                >
                    <HomeIcon name="notifications" className="size-6" />
                </button>

                <Link
                    href={`/${locale}/profile` as Route}
                    aria-label={initials === '' ? chrome.accountNoName : chrome.account}
                    // 44px mobile touch-target floor, reset at md — a no-op below the size-8 avatar today.
                    className="ml-1 flex size-8 min-h-11 min-w-11 items-center justify-center rounded-full bg-seafoam text-sm font-semibold text-white md:min-h-0 md:min-w-0"
                >
                    {initials === '' ? (
                        <HomeIcon name="profile" className="size-5" />
                    ) : (
                        <span aria-hidden="true">{initials}</span>
                    )}
                </Link>
            </div>
        </header>
    );
}
