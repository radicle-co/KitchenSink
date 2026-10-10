'use client';

/**
 * @module home/chrome/HomeTabBar — the bottom tab bar on web below `nav` (840) (`docs/design/uiOverhaul/buildSpec.md`
 * §3.2): the reachable destinations of the shared nav model (`resolveHomeNav` — Home, Recipes, Discover today), each a
 * 24 px glyph over a `caption` label, on the floating layer's material (`ChromeSurface`).
 *
 * - The active tab: `ink` glyph and label at weight 600 and a 32 × 3 px `hereBar` above the glyph, `aria-current`.
 *   Inactive: `inkMuted`. (Lucide has no filled glyph set, and a filled compass hides its needle, so the active tab is
 *   told by the bar, the weight and the colour — the blueprint's Q6, awaiting `staff-ux-engineer`.)
 * - A second tap on the active tab goes to the tab's root from a pushed route, and at the root scrolls to the top
 *   (`tabRootOf`; the page's `ScrollHost` moves the document).
 * - 64 px plus the bottom safe-area inset; each item at least 96 × 56 at 320 px.
 *
 * ⚠️ ORCHESTRATION in one respect: it reads the route (`usePathname`) and the page's scroll host to answer the second
 * tap. Everything it draws is derived from props.
 *
 * @pattern Adapter from the shared nav model and the current route to tab links
 */
import { NAV_ITEM_GLYPH, resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import { ChromeSurface } from '@commise/ui/chrome-surface';
import { Icon } from '@commise/ui/icon';
import { useScrollHost } from '@commise/ui/scroll-host';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX, MouseEvent, Ref } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { homeNavHref, tabRootOf } from './navHref';

/** Props for {@link HomeTabBar}. */
export interface HomeTabBarProps {
    /** The chrome copy, resolved for the active locale. */
    readonly chrome: WebMessages['home']['chrome'];
    /** The active locale segment. */
    readonly locale: string;
    /** Capabilities whose backing service is live — which destinations show. */
    readonly liveCapabilities: readonly string[];
    /** The active destination, marked `aria-current`; `null` on a page that is none of them (Profile, the 404). */
    readonly activeId: HomeNavItemId | null;
    /** Receives the laid-out bar, so the shell can tell its popups what the bar covers (`tabBarInsets`). */
    readonly ref?: Ref<HTMLElement>;
}

/**
 * The web bottom tab bar.
 *
 * @param props - The chrome copy, locale, live capabilities and active destination.
 * @returns The fixed bottom navigation (gone from `nav`).
 */
export function HomeTabBar({ chrome, locale, liveCapabilities, activeId, ref }: HomeTabBarProps): JSX.Element {
    const pathname = usePathname();
    const host = useScrollHost();

    const onTabClick = (id: HomeNavItemId) => (event: MouseEvent<HTMLAnchorElement>) => {
        const route = tabRootOf(pathname, locale);

        // The second tap AT the root scrolls to the top; from a pushed route the link's own navigation goes to the root.
        if (id === activeId && route.tab === id && route.atRoot) {
            event.preventDefault();
            host.scrollToTop();
        }
    };

    return (
        <nav
            ref={ref}
            data-tab-bar=""
            aria-label={chrome.tabNavLabel}
            // The bar grows by the bottom safe-area inset and pads its foot by the same amount, so the 64 px row sits
            // clear above the home indicator. `env(...)` is 0 in a normal viewport.
            className="fixed inset-x-0 bottom-0 z-50 isolate flex h-[calc(4rem+env(safe-area-inset-bottom))] justify-around px-2 pb-[env(safe-area-inset-bottom)] nav:hidden"
        >
            <ChromeSurface edge="top" />
            {resolveHomeNav(liveCapabilities).map((item) => {
                const href = homeNavHref(item.id, locale);
                const active = item.id === activeId;

                if (href === undefined) {
                    return null;
                }

                return (
                    <Link
                        key={item.id}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        onClick={onTabClick(item.id)}
                        className={`relative flex min-h-14 min-w-24 flex-1 flex-col items-center justify-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
                            active ? 'text-ink' : 'text-ink-muted'
                        }`}
                    >
                        <span
                            aria-hidden="true"
                            className={`absolute top-0 h-[3px] w-8 rounded-b-full ${active ? 'bg-here-bar' : ''}`}
                        />
                        <Icon name={NAV_ITEM_GLYPH[item.id]} size={24} />
                        <span className={`text-caption ${active ? 'font-semibold' : ''}`}>
                            {chrome.destinations[item.id]}
                        </span>
                    </Link>
                );
            })}
        </nav>
    );
}
