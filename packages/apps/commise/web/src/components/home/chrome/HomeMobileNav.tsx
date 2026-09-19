'use client';

/**
 * @module home/chrome/HomeMobileNav — the mobile navigation drawer (web; US-000 / FR-046, B6/CR-003).
 *
 * The slide-over the top-bar hamburger opens below the `lg` breakpoint. The bottom tab bar carries the
 * primary narrow-viewport nav as compact icons; this drawer is the fuller rendering — the same destinations
 * with their text labels and the product wordmark, and the "coming soon" context that the icon-only tab bar
 * cannot show. It renders the SAME shared nav model, so it cannot drift from the sidebar or the tab bar.
 *
 * ⚠️ Its cutover must stay the hamburger's (`HomeTopBar`, `lg:hidden`) and therefore the sidebar's
 * (`HomeSidebar`, `lg:flex`). Overlay and panel both hid at `md` while the sidebar only appeared at `lg`, so
 * 768–1023px had no full navigation at all — and a drawer that hides at a width where its own trigger is
 * still shown opens onto nothing (U39).
 *
 * A11y: built on Radix `Dialog` (mirrors `PullUpdatesDialog`'s pattern) — Radix owns the focus TRAP,
 * Escape-to-dismiss, backdrop-click dismiss, and background inert, so this component hand-rolls none of
 * that (no manual `keydown` listener, no `role="dialog"` div, no scrim button standing in for Radix's own
 * outside-click dismissal). `onOpenChange` maps every Radix close path onto the same `onClose` the explicit
 * close control uses — one exit path, not two.
 *
 * Focus on OPEN is Radix's own default, and it lands on the close control by construction: `FocusScope`
 * focuses the first tabbable in `Content` after removing links, and the close button is the only non-link
 * control in the drawer. That is why this component holds no ref. It used to override `onOpenAutoFocus` to
 * `.focus()` a `closeRef` — the same element Radix already picks — so the override bought nothing and cost a
 * sanctioned ref. `HomeChrome.test.tsx`'s "moves focus to the close control" case pins the outcome, so a markup
 * change that puts another control ahead of the close button reds there rather than silently moving focus.
 *
 * Focus on CLOSE is NOT Radix's default: the hamburger is a SIBLING control in `HomeTopBar`, not an owned
 * `Dialog.Trigger`, so Radix's own `onCloseAutoFocus` (which only restores an OWNED trigger — see
 * `PullUpdatesDialog`'s module doc) would silently focus nothing. `useReturnFocusOnClose`
 * (`@commise/ui/dialog-focus`) owns that half, snapshotting `document.activeElement` at the render where `open`
 * flips true, before `Dialog.Content` ever commits.
 *
 * @pattern Adapter over the house Radix `Dialog` for the slide-over drawer.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import { useReturnFocusOnClose } from '@commise/ui/dialog-focus';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import type { JSX } from 'react';

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
    // Snapshot whatever had focus right before this drawer opened, and restore it on close — see the module
    // doc. The false→true edge guard lives inside the hook.
    const onCloseAutoFocus = useReturnFocusOnClose(open);

    const destinations = resolveHomeNav(liveCapabilities);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/30 backdrop-blur-[2px] lg:hidden" />
                <Dialog.Content
                    aria-label={chrome.primaryNavLabel}
                    onCloseAutoFocus={onCloseAutoFocus}
                    /*
                     * `bg-hero` is the token-derived beach-glow ramp (`@commise/ui` `gradient.hero`, emitted as
                     * `--background-image-hero`). This drawer previously hand-spelled a two-stop ramp from the
                     * SAME pair of drifted tints the app shell used (#F5F8FA → #EDF5F8) — a third spelling of
                     * one gradient, and the reason the drift outlived the shell fix. It stays fully OPAQUE
                     * (every stop is a solid colour), which an overlay panel above page content requires.
                     */
                    className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/20 bg-hero shadow-[var(--shadow-xl)] lg:hidden"
                >
                    <div className="flex items-center justify-between p-6">
                        <span className="font-display text-xl font-bold text-charcoal">{chrome.wordmark}</span>
                        <Dialog.Close
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
