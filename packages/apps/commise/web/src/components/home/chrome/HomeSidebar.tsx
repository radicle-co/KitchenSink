'use client';

/**
 * @module home/chrome/HomeSidebar — the web sidebar at `nav` (840 px) and wider (`docs/design/uiOverhaul/buildSpec.md`
 * §3.2; ownerDecisions D5). It replaces the tab bar there. Sticky and full height, so it never scrolls away; its list
 * scrolls inside it if it is ever taller than the window. A flat `paper` panel over the canvas wash with no blur:
 * nothing scrolls under it, so glass would only cost a compositing pass (`modernizeA.md` §5).
 *
 * Top to bottom: the wordmark; **New recipe** (`newRecipe`, one tap to the editor since slice 8); the destinations
 * (`resolveHomeNav`); a divider; the profile row (the avatar and the cook's name, to Profile); the collapse control.
 * 256 px expanded, 80 px collapsed. Collapsed is a visual state, not an information state: each control keeps its
 * accessible name.
 *
 * Presentational: every fact arrives in props; the collapse is the parent's state.
 */
import { NAV_ITEM_GLYPH, initialsFor, resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import { AvatarDisc } from '@commise/ui/avatar';
import { Icon } from '@commise/ui/icon';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import type { WebMessages } from '@/i18n/messages';

import { homeNavHref } from './navHref';
import { profileLabelOf, type ProfileEntry } from '@commise/features-core';

/** Props for {@link HomeSidebar}. */
export interface HomeSidebarProps {
    readonly chrome: WebMessages['home']['chrome'];
    readonly locale: string;
    readonly liveCapabilities: readonly string[];
    /** The active destination, marked `aria-current`; `null` on a page that is none of them. */
    readonly activeId: HomeNavItemId | null;
    /** The profile read, for the profile row. */
    readonly profile: ProfileEntry;
    /** Whether the sidebar is collapsed to the 80 px rail. */
    readonly collapsed: boolean;
    readonly onToggleCollapse: () => void;
    /** The New recipe control, drawn for the current width (the full-width button, or the rail's round one). */
    readonly newRecipe: ReactNode;
}

/** A 44 px row's shape, shared by the destinations and the profile row. */
const ROW_CLASS =
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/**
 * The web sidebar.
 *
 * @param props - The copy, locale, live capabilities, active destination, profile read, collapse state and New recipe.
 * @returns The sticky navigation sidebar (hidden below `nav`).
 */
export function HomeSidebar({
    chrome,
    locale,
    liveCapabilities,
    activeId,
    profile,
    collapsed,
    onToggleCollapse,
    newRecipe,
}: HomeSidebarProps): JSX.Element {
    const profileLabel = profileLabelOf(chrome, profile.name);

    return (
        <div
            data-collapsed={collapsed ? 'true' : 'false'}
            className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-e border-line-divider bg-paper/70 nav:flex ${
                collapsed ? 'w-20 items-center' : 'w-64'
            }`}
        >
            <div className={`flex h-16 shrink-0 items-center ${collapsed ? 'justify-center' : 'px-6'}`}>
                <span
                    className="font-display text-xl font-bold text-ink"
                    aria-label={collapsed ? chrome.logoAlt : undefined}
                >
                    {collapsed ? chrome.wordmark.slice(0, 1) : chrome.wordmark}
                </span>
            </div>

            <div className={collapsed ? 'flex justify-center px-3 pb-3' : 'px-4 pb-3'}>{newRecipe}</div>

            <nav aria-label={chrome.primaryNavLabel} className="flex flex-col gap-1 px-3">
                {resolveHomeNav(liveCapabilities).map((item) => {
                    const href = homeNavHref(item.id, locale);
                    const active = item.id === activeId;
                    const label = chrome.destinations[item.id];

                    if (href === undefined) {
                        return null;
                    }

                    return (
                        <Link
                            key={item.id}
                            href={href}
                            aria-label={collapsed ? label : undefined}
                            aria-current={active ? 'page' : undefined}
                            className={`${ROW_CLASS} relative ${collapsed ? 'justify-center' : ''} ${
                                active
                                    ? 'bg-action/10 font-semibold text-ink'
                                    : 'text-ink-muted hover:bg-ink/6 hover:text-ink'
                            }`}
                        >
                            <span
                                aria-hidden="true"
                                className={`absolute inset-y-2 start-0 w-[3px] rounded-e-full ${active ? 'bg-here-bar' : ''}`}
                            />
                            <Icon name={NAV_ITEM_GLYPH[item.id]} size={24} />
                            {collapsed ? null : <span>{label}</span>}
                        </Link>
                    );
                })}
            </nav>

            <div className="mx-3 my-3 border-t border-line-divider" />

            <Link
                href={`/${locale}/profile` as Route}
                aria-label={profileLabel}
                className={`${ROW_CLASS} mx-3 text-ink hover:bg-ink/6 ${collapsed ? 'justify-center' : ''}`}
            >
                <AvatarDisc status={profile.status} initials={initialsFor(profile.name)} />
                {collapsed ? null : (
                    <span className="min-w-0 truncate">{profile.name ?? chrome.profileButtonNoName}</span>
                )}
            </Link>

            <button
                type="button"
                onClick={onToggleCollapse}
                aria-expanded={!collapsed}
                aria-label={collapsed ? chrome.expandNav : undefined}
                className={`${ROW_CLASS} mx-3 mb-3 mt-auto text-ink-muted hover:bg-ink/6 hover:text-ink ${
                    collapsed ? 'justify-center' : ''
                }`}
            >
                <span className={`inline-flex ${collapsed ? 'rotate-180' : ''}`}>
                    <Icon name="chevronsLeft" size={24} />
                </span>
                {collapsed ? null : <span>{chrome.collapseNav}</span>}
            </button>
        </div>
    );
}
