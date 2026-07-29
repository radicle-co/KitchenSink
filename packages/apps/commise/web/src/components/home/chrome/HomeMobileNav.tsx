'use client';

/**
 * @module home/chrome/HomeMobileNav — the mobile navigation drawer (web; US-000 / FR-046, B6/CR-003).
 *
 * The slide-over the top-bar hamburger opens below the `md` breakpoint. The bottom tab bar carries the
 * primary mobile nav as compact icons; this drawer is the fuller rendering — the same destinations with
 * their text labels and the product wordmark, and the "coming soon" context that the icon-only tab bar
 * cannot show. It renders the SAME shared nav model, so it cannot drift from the sidebar or the tab bar.
 *
 * A11y: built on Radix `Dialog` (mirrors `PullUpdatesDialog`'s pattern) — Radix owns the focus TRAP,
 * Escape-to-dismiss, backdrop-click dismiss, and background inert, so this component hand-rolls none of
 * that (no manual `keydown` listener, no `role="dialog"` div, no scrim button standing in for Radix's own
 * outside-click dismissal). `onOpenChange` maps every Radix close path onto the same `onClose` the explicit
 * close control uses — one exit path, not two.
 *
 * Focus is moved explicitly, NOT left to Radix's defaults, in both directions: `onOpenAutoFocus` focuses the
 * close control (`closeRef`) on open (preserving the drawer's pre-Radix behavior), and `onCloseAutoFocus`
 * restores focus to the hamburger that opened it. The hamburger is a SIBLING control in `HomeTopBar`, not an
 * owned `Dialog.Trigger`, so Radix's own default `onCloseAutoFocus` (which only restores an OWNED trigger —
 * see `PullUpdatesDialog`'s module doc) would silently focus nothing; `triggerRef` captures
 * `document.activeElement` at the render where `open` flips true, before `Dialog.Content` ever commits.
 *
 * ALLOWED REF (§3, `closeRef`) — B14 re-verified this is NOT the render-mutated/state-in-ref smell that task
 * eliminates elsewhere: `closeRef` wraps the close button's actual DOM node so `onOpenAutoFocus` can call the
 * imperative `.focus()` the DOM API requires — there is no declarative way to say "focus THIS specific
 * element" instead of Radix's own default (first-focusable/`Content`). Removing it would silently regress to
 * Radix's default autofocus target, changing the drawer's documented open-focus behavior (pinned by
 * `HomeChrome.test.tsx`'s "moves focus to the close control" case). `triggerRef`/`wasOpenRef` are the
 * separate, React-sanctioned "read the previous render's value" pattern (conditionally captured on the
 * false→true edge, not an unconditional latest-value bridge) and are unrelated to this ref.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { useRef, type JSX } from 'react';

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
 * @returns The Radix `Dialog.Root` — its `Content` (the drawer) is present in the DOM only while `open`.
 */
export function HomeMobileNav({
    open,
    onClose,
    chrome,
    locale,
    liveCapabilities,
    activeId,
}: HomeMobileNavProps): JSX.Element {
    const closeRef = useRef<HTMLButtonElement>(null);

    // Capture whatever had focus right before this drawer opened, during render (not an effect) — see the
    // module doc. Guarded on the false→true edge so it isn't re-captured on every re-render while open.
    const triggerRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);

    if (open && !wasOpenRef.current) {
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    wasOpenRef.current = open;

    const destinations = resolveHomeNav(liveCapabilities);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/30 backdrop-blur-[2px] md:hidden" />
                <Dialog.Content
                    aria-label={chrome.primaryNavLabel}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        closeRef.current?.focus();
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                    className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/20 bg-gradient-to-b from-[#F5F8FA] to-[#EDF5F8] shadow-[var(--shadow-xl)] md:hidden"
                >
                    <div className="flex items-center justify-between p-6">
                        <span className="font-display text-xl font-bold text-charcoal">{chrome.wordmark}</span>
                        <Dialog.Close
                            ref={closeRef}
                            aria-label={chrome.closeNav}
                            className="rounded-full p-1 text-slate transition-colors hover:text-charcoal"
                        >
                            <HomeIcon name="collapse-left" className="size-6" />
                        </Dialog.Close>
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
                                        // Contrast (WCAG 2.1 AA, #113): opaque `slate` (5.24:1); `text-slate/60` was 2.41:1.
                                        className="flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 text-slate"
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
                                            ? // The gradient pill stays seafoam (a non-text accent); the
                                              // FOREGROUND — which colours the visible label — is `ocean-dark`
                                              // (see the palette JSDoc in `@commise/ui`).
                                              'bg-gradient-to-r from-seafoam/[0.12] to-seafoam/[0.08] text-ocean-dark'
                                            : 'text-slate hover:bg-white/40 hover:text-charcoal'
                                    }`}
                                >
                                    <HomeIcon name={item.id} className="size-6 shrink-0" />
                                    <span className="font-medium">{label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
