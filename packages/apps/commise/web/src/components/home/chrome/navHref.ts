/**
 * @module home/chrome/navHref — maps a Home nav destination id to its web route (web).
 *
 * The set of destinations, their order, and which are gated live once in `@commise/features-core`
 * (`homeNavigation.ts`, shared with mobile). What a destination's URL is on THIS platform is web-specific
 * (a Next `Route`), so it lives here. Only the destinations that are reachable in Home v1 have a route;
 * a gated destination (meal-plan, grocery, nutrition) has none — it renders as non-interactive "coming
 * soon" and must never be linked to a 404.
 */
import type { HomeNavItemId } from '@commise/features-core';
import type { Route } from 'next';

/**
 * The web route for a Home nav destination, or `undefined` when the destination is not routable in v1.
 *
 * @param id - The shared nav destination id.
 * @param locale - The active locale segment.
 * @returns The locale-prefixed route, or `undefined` for a not-yet-shipped destination. Pure.
 */
export function homeNavHref(id: HomeNavItemId, locale: string): Route | undefined {
    switch (id) {
        case 'home':
            return `/${locale}` as Route;
        case 'recipes':
            return `/${locale}/recipes` as Route;
        case 'profile':
            return `/${locale}/profile` as Route;
        default:
            // meal-plan, grocery, nutrition — gated in v1, so deliberately unrouted.
            return undefined;
    }
}
