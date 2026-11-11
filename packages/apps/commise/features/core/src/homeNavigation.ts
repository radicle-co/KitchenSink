/**
 * @module @commise/features-core — the shared Home navigation model.
 *
 * The web sidebar (840 px and wider), the web tab bar and the native tab bar are three RENDERINGS of one list of
 * destinations. The list itself — which destinations exist, their order, and what each waits on — is product
 * knowledge, so it lives here once (FR-044 parity: the platforms cannot drift on it), while the icons,
 * routing, and markup fork per platform.
 *
 * **Reachability is derived, never declared.** A destination for an unshipped feature is gated on the SAME
 * `capability` vocabulary that gates the Home widget placeholders (`roadmapWidgets.ts`), so the nav and the
 * widget surface are incapable of disagreeing: when meal-planning goes live, its widget placeholder yields to
 * the real widget AND its nav entry becomes reachable, from one fact. Hard-coding a `disabled: true` here
 * would be a second copy of that fact, and the two would drift the day the service deployed.
 *
 * **An unreachable destination is not shown** (owner ruling, `docs/design/uiOverhaul/ownerDecisions.md`: "Navigation
 * shows no 'Soon' items"). The tabs are Home, Recipes, Discover and You. Plan and Shop join BEFORE You when their
 * capability goes live, so You stays last (owner ruling 2026-11-11, `ownerFeedback.md` N3). You is Profile: the web tab
 * bar and the native bar draw it as the cook's avatar and the web sidebar leaves it out of its list, because the
 * sidebar's first row is the same entry. Nutrition sits inside Plan.
 * This reverses the CR-001 rule that rendered a gated destination as "coming soon".
 *
 * @pattern Registry — the destinations, keyed by id, with a total glyph table beside them
 */

import type { IconName } from '@commise/ui/icon-names';
import { ROADMAP_CAPABILITIES } from './capabilities.js';

/** A Home navigation destination, as declared (platform-independent). */
export interface HomeNavItem {
    /** Stable destination id. The apps map it to a route and an icon. */
    readonly id: HomeNavItemId;
    /**
     * The capability whose backing service this destination needs. Absent means always reachable. When present and
     * not live, the destination is left out of the navigation — never a dead link, never a "coming soon" item.
     */
    readonly capability?: string;
}

/** Every navigation destination id, in tab order (`docs/design/uiOverhaul/buildSpec.md` §3.1). */
export type HomeNavItemId = 'home' | 'recipes' | 'discover' | 'meal-plan' | 'grocery' | 'you';

/**
 * The destinations, in tab order: the three shipped tabs, Plan and Shop (each waiting on its capability from the
 * shared {@link ROADMAP_CAPABILITIES} vocabulary — `grocery` waits on `shopping`, the same 005–009 cohort even though
 * it has no Home widget of its own), then You, which is last and always reachable.
 */
export const HOME_NAV_ITEMS: readonly HomeNavItem[] = [
    { id: 'home' },
    { id: 'recipes' },
    { id: 'discover' },
    { id: 'meal-plan', capability: ROADMAP_CAPABILITIES.mealPlanning },
    { id: 'grocery', capability: ROADMAP_CAPABILITIES.shopping },
    { id: 'you' },
];

/**
 * How far a tab label grows with the system text size: 1.3× its caption size, then it stops (owner ruling 2026-11-11,
 * `buildSpec.md` §3.2). Four tabs at 320 leave 80 each, which "Discover" at the 1.5× the other navigation chrome keeps
 * does not fit. One number for both apps: native reads it as its chrome step, web as a `min()` on the label's size.
 */
export const TAB_LABEL_TEXT_CAP = 1.3;

/** The You tab's avatar disc, in px (web) and pt (native): 24, a `YouTabDisc` in each app (`buildSpec.md` §3.2). */
export const YOU_TAB_DISC_SIZE = 24;

/** The initials in that disc: 10, which does not grow with the system text size (`buildSpec.md` §3.2). */
export const YOU_TAB_INITIALS_SIZE = 10;

/**
 * The icon Registry meaning each destination draws (`@commise/ui/icon`), ONCE for both apps' chrome. A total `Record`
 * over {@link HomeNavItemId}, so a destination without a glyph does not compile.
 */
export const NAV_ITEM_GLYPH: Readonly<Record<HomeNavItemId, IconName>> = {
    home: 'house',
    recipes: 'bookOpen',
    discover: 'compass',
    'meal-plan': 'calendar',
    grocery: 'shoppingCart',
    you: 'user',
};

/**
 * Whether a destination can be navigated to, given the live capabilities.
 *
 * @param item - The declared destination.
 * @param liveCapabilities - Capabilities whose backing service is live.
 * @returns True when the destination is ungated or its capability is live. Pure.
 */
export function isNavItemReachable(item: HomeNavItem, liveCapabilities: readonly string[]): boolean {
    return item.capability === undefined || liveCapabilities.includes(item.capability);
}

/**
 * The destinations to show, given the live capabilities.
 *
 * @param liveCapabilities - Capabilities whose backing service is live.
 * @returns The reachable destinations, in declared order. An unreachable one is left out (see the module note). Pure.
 */
export function resolveHomeNav(liveCapabilities: readonly string[]): readonly HomeNavItem[] {
    return HOME_NAV_ITEMS.filter((item) => isNavItemReachable(item, liveCapabilities));
}
