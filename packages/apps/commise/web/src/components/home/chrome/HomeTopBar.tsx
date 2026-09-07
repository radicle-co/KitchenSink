'use client';

/**
 * @module home/chrome/HomeTopBar — the sticky app top bar (web; US-000 / FR-046).
 *
 * The `h-14` glass bar from the mockup: a narrow-viewport nav trigger (hamburger, hidden at `lg`+ where the
 * sidebar takes over), the current surface's title, a search affordance, a notifications affordance, and the
 * account avatar.
 *
 * ## The title is CALLER-supplied, and is NOT a heading
 *
 * It used to read `chrome.pageTitle` — one hard-coded 'Home' rendered on every shell-hosted route — so the
 * recipe list, an editor, and the account page all announced themselves as "Home". It is now a `pageTitle`
 * prop the shell resolves per surface.
 *
 * It is also deliberately plain text rather than a heading. Every shell-hosted page's own `<main>` content
 * already renders the authoritative `<h1>`, so exposing this bar's title as an `h1` too gave each page TWO —
 * and once the title became per-route it would additionally be a SECOND heading carrying the SAME accessible
 * name as the page's own `h1` on most routes ("Recipes", "Profile", "Settings", …), which is ambiguous to
 * anyone navigating by heading. The `<header>` banner landmark is the structural anchor; the text inside it is
 * orientational chrome that stays visible while the page scrolls.
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
 *
 * ## Touch floors go on the CONTROL box, never on a painted one
 *
 * The 44px mobile touch minimum is a floor on the interactive box. Putting it on a box that also PAINTS is a
 * defect: `min-height`/`min-width` cannot lose to `height`/`width`, so a floor larger than the paint silently
 * replaces the design's geometry — which is how the 32px avatar came to paint as a 44px disc inside a 56px
 * bar. The avatar therefore nests the disc inside a transparent 44px link, the structure both the mockup
 * (`screen-home`) and the native leaf already use.
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
    /** The chrome copy (accessible names + nav labels), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /**
     * The localized title of the surface currently in the shell (e.g. "Version history"). Rendered as plain
     * banner text, never a heading — the page content owns the `<h1>` (see the module doc).
     */
    readonly pageTitle: string;
    /** The active locale segment, for the account link route. */
    readonly locale: string;
    /** The viewer's display name, if known — the source of the avatar initials. */
    readonly displayName: string | undefined;
    /** Open the navigation drawer (hamburger; only shown below `lg`, where the sidebar is not yet present). */
    readonly onOpenNav: () => void;
}

/**
 * The sticky app top bar.
 *
 * @param props - The chrome copy, the current surface's title, the locale, the viewer display name, and the
 *   mobile-nav open handler.
 * @returns The sticky glass header.
 */
export function HomeTopBar({ chrome, pageTitle, locale, displayName, onOpenNav }: HomeTopBarProps): JSX.Element {
    const initials = initialsFor(displayName);

    return (
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/20 bg-gradient-to-r from-white/50 to-white/40 px-4 backdrop-blur-[16px]">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onOpenNav}
                    aria-label={chrome.openNav}
                    // ⚠️ The hide variant is `lg`, not `md` — it must be the SAME cutover the sidebar appears
                    // at (`HomeSidebar`'s `lg:flex`) and the tab bar disappears at (`HomeTabBar`'s
                    // `lg:hidden`). This control used to hide one breakpoint EARLIER than the sidebar arrived,
                    // so between 768 and 1023px a viewer had NEITHER: the full navigation was unreachable on a
                    // tablet and only the tab bar's compact icons survived (U39).
                    //
                    // `min-h-11 min-w-11` (44px) is the touch-target FLOOR, and unlike its three siblings it
                    // carries NO `md`-variant release: the control is 40px on its own (`p-2` + a 24px glyph —
                    // the mockup's icon button), and every width it is rendered at is a narrow or tablet
                    // layout where 44px is the point. That release was a no-op here only while the button also
                    // hid at the earlier breakpoint; closing the gap above would have made it LIVE and shrunk
                    // a tablet's one navigation affordance to 40px.
                    //
                    // Tailwind v4 scans this file as TEXT, comments included, so the retired class is
                    // DESCRIBED rather than spelled — writing it verbatim regenerates the dead utility.
                    className="-ml-2 min-h-11 min-w-11 rounded-full p-2 text-charcoal transition-colors hover:bg-pearl lg:hidden"
                >
                    <HomeIcon name="menu" className="size-6" />
                </button>
                {/* Plain text, NOT a heading — the page's own content owns the single `<h1>` (module doc). */}
                <p className="text-lg font-semibold text-charcoal">{pageTitle}</p>
            </div>

            <div className="flex items-center gap-1">
                <button
                    type="button"
                    aria-label={chrome.search}
                    // 44px mobile touch-target floor, reset at md. The control is the mockup's 40px icon
                    // button (`p-2` + 24px glyph), so on mobile this floor is what reaches 44px.
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
                    // The 44px touch floor lives on this TRANSPARENT control box, never on the painted disc
                    // below it: CSS resolves a used length as `max(min-size, size)`, so a floor sharing a box
                    // with `size-8` would paint the disc itself at 44px. Reset at `md:`, where the control
                    // collapses onto the disc it wraps.
                    //
                    // Historical note, because the original diagnosis here was WRONG and cost a second pass:
                    // the disc really did overflow the `h-14` bar, but not because the floor beat `size-8`.
                    // The DS emitted its own ramp into Tailwind's `--spacing-*` namespace, so `size-8`
                    // resolved to 4rem/64px — larger than the 56px bar — while `h-14` and `min-h-11` still
                    // resolved through the default `--spacing` base. Splitting the boxes was right for the
                    // touch target but could not have fixed the size; only freeing the namespace did.
                    className="ml-1 flex min-h-11 min-w-11 items-center justify-center rounded-full md:min-h-0 md:min-w-0"
                >
                    {/* The painted disc — the mockup's `w-8 h-8` circle (`screen-home`), and the same 32px
                        the native leaf's `styles.avatar` paints. */}
                    <span className="flex size-8 items-center justify-center rounded-full bg-seafoam text-sm font-semibold text-white">
                        {initials === '' ? (
                            <HomeIcon name="profile" className="size-5" />
                        ) : (
                            <span aria-hidden="true">{initials}</span>
                        )}
                    </span>
                </Link>
            </div>
        </header>
    );
}
