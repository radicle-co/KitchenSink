/**
 * @module components/foods/foodHref — where the author's food page lives on web (private foods spec section 5).
 *
 * The app, not the shared feature package, knows its own routes (as `dataSourcesHref` does for its page). The page is
 * linked from more than one surface, so every web link to it takes its address from here. ⚠️ The address is a one-way
 * door: it is linked from a refused publish and bookmarked.
 */
import type { Route } from 'next';

import { withBasePath } from '@/lib/basePath';

/**
 * The food page for a locale. Pure.
 *
 * @param locale - The active route locale.
 * @param foodId - The food's id, encoded so it is always one path segment.
 * @returns The locale-prefixed route.
 */
export function foodHref(locale: string, foodId: string): Route {
    return `/${locale}/foods/${encodeURIComponent(foodId)}` as Route;
}

/**
 * Open the food page in a new tab, so the page the cook opened it from stays where they left it (spec D5).
 *
 * @param locale - The active route locale.
 * @param foodId - The food's id.
 * @sideEffect Opens a browser tab, with no opener.
 */
export function openFoodInNewTab(locale: string, foodId: string): void {
    window.open(withBasePath(foodHref(locale, foodId)), '_blank', 'noopener');
}
