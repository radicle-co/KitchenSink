/**
 * @module @commise/features-core — the shared Home navigation model.
 *
 * The desktop sidebar, the web mobile tab bar, and the native tab bar are three RENDERINGS of one list of
 * destinations. The list itself — which destinations exist, their order, and what each waits on — is product
 * knowledge, so it lives here once (FR-044 parity: the platforms cannot drift on it), while the icons,
 * routing, and markup fork per platform.
 *
 * **Reachability is derived, never declared.** A destination for an unshipped feature is gated on the SAME
 * `capability` vocabulary that gates the Home widget placeholders (`roadmapWidgets.ts`), so the nav and the
 * widget surface are incapable of disagreeing: when meal-planning goes live, its widget placeholder yields to
 * the real widget AND its nav entry becomes reachable, from one fact. Hard-coding a `disabled: true` here
 * would be a second copy of that fact, and the two would drift the day the service deployed.
 */

import { ROADMAP_CAPABILITIES } from './capabilities.js';

/** A Home navigation destination, as declared (platform-independent). */
export interface HomeNavItem {
    /** Stable destination id. The apps map it to a route and an icon. */
    readonly id: HomeNavItemId;
    /**
     * The capability whose backing service this destination needs. Absent means always reachable. When
     * present and not live, the destination renders as non-interactive "coming soon" — NEVER as a dead link
     * to a 404.
     */
    readonly capability?: string;
}

/** Every Home navigation destination id, in mockup order. */
export type HomeNavItemId = 'home' | 'recipes' | 'meal-plan' | 'grocery' | 'nutrition' | 'profile';

/**
 * The six destinations of the Home chrome, in the mockup's order. Gated destinations name their capability
 * from the shared {@link ROADMAP_CAPABILITIES} vocabulary — `grocery` waits on `shopping`, which is the same
 * 005–009 cohort even though it has no Home widget of its own in the mockup.
 */
export const HOME_NAV_ITEMS: readonly HomeNavItem[] = [
    { id: 'home' },
    { id: 'recipes' },
    { id: 'meal-plan', capability: ROADMAP_CAPABILITIES.mealPlanning },
    { id: 'grocery', capability: ROADMAP_CAPABILITIES.shopping },
    { id: 'nutrition', capability: ROADMAP_CAPABILITIES.nutrition },
    { id: 'profile' },
];

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

/** A destination resolved against the viewer's live capabilities, ready to render. */
export interface ResolvedHomeNavItem extends HomeNavItem {
    /** False → render non-interactive with an accessible "coming soon" name, and do NOT link it. */
    readonly reachable: boolean;
}

/**
 * Resolve every Home destination against the live capabilities.
 *
 * Note it **never drops** a destination: an unshipped feature is shown as coming soon, not hidden. Hiding it
 * would leave a sighted user unable to tell the roadmap exists, and would contradict the placeholder decision
 * (CR-001) that the surface should communicate what is coming rather than pretend it does not exist.
 *
 * @param liveCapabilities - Capabilities whose backing service is live.
 * @returns Every destination in declared order, each tagged with its reachability. Pure.
 */
export function resolveHomeNav(liveCapabilities: readonly string[]): readonly ResolvedHomeNavItem[] {
    return HOME_NAV_ITEMS.map((item) => ({ ...item, reachable: isNavItemReachable(item, liveCapabilities) }));
}
