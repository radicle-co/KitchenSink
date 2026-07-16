/**
 * @module home/chrome/icons — the Home chrome's line icons (web).
 *
 * A small, self-contained set of stroked line icons matching the Home mockup (sidebar destinations, top-bar
 * affordances, and nav controls). They are hand-inlined SVG rather than a new icon-library dependency: the
 * set is fixed and tiny (ten glyphs), so a dependency would cost more than it saves (YAGNI), and the mockup's
 * exact paths are the design contract.
 *
 * Every icon is **decorative**: it is always paired with a real text label (a nav item's name, an affordance's
 * accessible name), so each carries `aria-hidden` and is removed from the accessibility tree. The accessible
 * name is owned by the surrounding control, never the glyph — this is what keeps a screen reader from
 * announcing "image" beside an already-labelled button.
 */
import type { JSX, SVGProps } from 'react';

import type { HomeNavItemId } from '@commise/features-core';

/** The stroked-path data for each glyph (24×24 viewbox, matching the mockup). */
const ICON_PATHS = {
    home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    recipes:
        'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    'meal-plan': 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    grocery:
        'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    nutrition:
        'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    notifications:
        'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    menu: 'M4 6h16M4 12h16M4 18h16',
    'collapse-left': 'M11 19l-7-7 7-7m8 14l-7-7 7-7',
} as const;

/** Every glyph name this module can draw. */
export type HomeIconName = keyof typeof ICON_PATHS;

/** The chrome affordance/control icons — the ids that are NOT navigation destinations. */
export type HomeControlIconName = Exclude<HomeIconName, HomeNavItemId>;

/**
 * A decorative stroked line icon.
 *
 * @param props - The glyph `name` plus any presentational SVG props (e.g. `className` for sizing). The icon
 * is always `aria-hidden`; the caller owns the accessible name.
 * @returns The `aria-hidden` SVG glyph.
 */
export function HomeIcon({
    name,
    ...svgProps
}: { readonly name: HomeIconName } & SVGProps<SVGSVGElement>): JSX.Element {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
            {...svgProps}
        >
            <path d={ICON_PATHS[name]} />
        </svg>
    );
}
