/**
 * @module @commise/features-recipes — the My Recipes / Community source switcher (L5), web leaf.
 *
 * ONE strip, rendered by BOTH recipe-source surfaces — the personal library (`RecipeList`) and the community
 * surface (`RecipeDiscoveryList`). It exists as its own component precisely because the two surfaces DID
 * drift: `/recipes` drew the strip while `/discover` drew nothing, so choosing "Community" was a one-way trip
 * with no way back. A single shared switcher makes that asymmetry unrepresentable — a surface either mounts
 * this and gets both destinations, or mounts no switcher at all.
 *
 * ## Pattern: style recipe + a pure `props → JSX` presentational component
 *
 * No state, no data, no effects. The surface is three module-level class recipes (`BASE` / `SELECTED` /
 * `UNSELECTED`) so the resting affordance and the palette rule live in one readable place, in the spirit of
 * `@commise/ui`'s `buttonSurfaceClass`.
 *
 * ## Semantics: these are LINKS on web, and `tab`s on native — deliberately, not by accident
 *
 * Each source is a distinct URL (`/{locale}/recipes`, `/{locale}/discover`), so on web this is NAVIGATION,
 * and navigation belongs to an `<a>`. `@commise/ui`'s `surfaceClass.ts` already states the rule this repo
 * follows: *"a navigation control must stay an `<a>` / `next/link`, or it loses link semantics — the `link`
 * role, middle-click / ⌘-click, the status-bar target preview, and 'open in new tab'. Turning a navigation
 * into a `<button onClick={router.push}>` … is an accessibility regression."* That is exactly what this
 * strip used to be. `role="tab"` was the second half of the same mistake: the ARIA tab pattern describes a set
 * of layered PANELS inside one document (`aria-selected`, an owned `tabpanel`), which is not what a control
 * that replaces the document is doing — so the active source is marked with `aria-current="page"`, the
 * standard for "this is the destination you are on", inside a `<nav>`.
 *
 * The native leaf (`RecipeSourceTabs.native.tsx`) keeps `accessibilityRole="tab"`, and that is the SAME model
 * expressed in the platform that has it: React Native has no URLs, no address bar and no new tab, and its
 * shell switches screens in place — so the platform's own trait for a top-level destination switcher IS the
 * tab trait. The repo already resolved this split identically for app-level navigation: the web `HomeTabBar`
 * is `<nav>` + `next/link` + `aria-current`, while the mobile `HomeTabBar` is `tablist`/`tab`. Parity is on
 * the MODEL and the behaviour (both platforms show both sources on both surfaces, mark the active one, and
 * land you on the other when chosen), not on the element name.
 */
import { useMessages } from '@commise/i18n/react';
import Link from 'next/link';
import type { ComponentProps, FC } from 'react';

import { recipeMessages } from '../messages.js';
import { RECIPE_SOURCE_TABS, sourceTabLabel, type RecipeListTabControl } from './model.js';

/**
 * Geometry + type shared by both states. `min-h-11` is the 44px touch floor, reset at `md:` so the desktop
 * tab density (`py-2`) is unchanged; `-mb-px` laps the strip's own hairline so the tabs sit ON the rule.
 *
 * The keyboard-focus ring is `ocean-dark` (6.20:1 on white), deliberately NOT `seafoam-light`. A focus
 * indicator is a non-text graphic on the 3:1 SC 1.4.11 floor and `seafoam-light` measures 2.78:1 on white —
 * under it — so reusing that token here would ship the accessibility defect this component exists to remove.
 * `ocean-dark` keeps the hue family and clears the floor (asserted in the tests, so a re-theme cannot quietly
 * drop it back under).
 *
 * The wider `ring-seafoam-light` usage this once called out as "a separate, pre-existing gap" is CLOSED (#114):
 * all 15 of those call sites now ring `seafoam` (4.67:1 on white, 4.34:1 on the `sand` page), so this strip is
 * a darker member of the same hue family rather than the app's only compliant ring. It stays `ocean-dark`
 * because the tab strip's own `pearl`/`white` folder fills are the lightest surfaces any ring in the app sits
 * on; converging it to `seafoam` would be a pure restyle with no measured gain.
 */
const BASE =
    '-mb-px inline-flex min-h-11 items-center rounded-t-lg px-4 py-2 text-body-sm font-semibold transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-dark md:min-h-0';

/**
 * The active source: a white "front folder" carrying the seafoam underline.
 *
 * The underline stays `seafoam` while the LABEL is `ocean-dark` — that split is the palette rule, measured,
 * not a matter of taste: seafoam as TEXT is 4.02:1 on white (under the 4.5:1 SC 1.4.3 floor) but clears the
 * 3:1 SC 1.4.11 floor a 2px indicator owes. See the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`; do
 * not "fix" it to one colour.
 */
const SELECTED = 'border-b-2 border-seafoam bg-white text-ocean-dark shadow-sm';

/**
 * The inactive source, and the whole of the affordance fix.
 *
 * It used to be `border-transparent text-slate hover:text-charcoal` — no box, no fill, and the ONLY signal
 * that it was pressable was a hover colour, which does not exist on a touch device at all. So a viewer on a
 * phone saw two words and no control. It now rests as a visible folder tab: a `pearl` fill and a `slate`
 * hairline, both present WITHOUT a pointer.
 *
 * Both halves are measurable, and both are asserted (`utilityContrast`, rest AND hover):
 *  - label `slate` on the `pearl` fill = 4.81:1, clearing the 4.5:1 SC 1.4.3 text floor;
 *  - the `slate` hairline is the control's BOUNDARY, so it owes 3:1 (SC 1.4.11) against the fill — 4.81:1.
 *    `mist` is the tone this would reach for by instinct and it fails at 1.74:1, which is why the boundary is
 *    slate: it is the lightest token in the palette that clears the floor at all.
 *  - hover deepens the fill to `mist/40` (composited over the page, since a `hover:bg-*` REPLACES the resting
 *    fill rather than stacking on it) and the label to `charcoal`; the hairline stays slate at 3.94:1 there.
 */
const UNSELECTED = 'border-b border-slate bg-pearl text-slate hover:bg-mist/40 hover:text-charcoal';

/** Props for {@link RecipeSourceTabs}. */
export interface RecipeSourceTabsProps {
    /** Which source is showing, and where each source lives. */
    readonly tab: RecipeListTabControl;
}

/**
 * The recipe-source switcher.
 *
 * @param props - The active source + its destinations.
 * @returns A `nav` of one link per source, the active one marked `aria-current="page"`.
 */
export const RecipeSourceTabs: FC<RecipeSourceTabsProps> = ({ tab }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <nav aria-label={list.tabsLabel} className="flex gap-2 border-b border-border">
            {RECIPE_SOURCE_TABS.map((value) => {
                const selected = tab.active === value;

                return (
                    <Link
                        key={value}
                        // The shared control types destinations as plain strings — a cross-platform model
                        // cannot depend on Next's generated route union — so the web leaf is where the two
                        // meet. The cast reads the accepted type OFF `Link` itself (rather than importing
                        // `Route` from `'next'`, whose barrel drags Next's GLOBAL type declarations into every
                        // program that touches this package — including the mobile app's `tsc`, where they
                        // silently re-type `process.env`). The app builds these from its own `Route` segments.
                        href={tab.href[value] as ComponentProps<typeof Link>['href']}
                        aria-current={selected ? 'page' : undefined}
                        className={`${BASE} ${selected ? SELECTED : UNSELECTED}`}
                    >
                        {sourceTabLabel(value, list)}
                    </Link>
                );
            })}
        </nav>
    );
};
