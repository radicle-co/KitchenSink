/**
 * @module @commise/features-recipes/list — the library's list/grid choice, kept per device
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3; blueprint Part C): a cookie on web, so the server renders the cook's
 * choice with no hydration flip, and the device store on native. One key on both. Not personal data: one word about the
 * view. Until the cook chooses, the width picks (`defaultViewModeOf`), and that default is never stored, so a phone's
 * default does not pin a later wide screen.
 *
 * Pure.
 */
import type { ContainerClass } from '@commise/ui/container-class';

import { defaultViewModeOf, isListViewMode, type ListViewMode } from '../card/cardVariant.js';

/** The key the choice is stored under: the cookie's name on web, the device store's key on native. */
export const VIEW_MODE_KEY = 'recipes.viewMode';

/**
 * Parse a stored value.
 *
 * @param stored - What the store holds, if anything.
 * @returns The choice, or `undefined` for none or a value that is not one.
 */
export function viewModeFrom(stored: unknown): ListViewMode | undefined {
    return isListViewMode(stored) ? stored : undefined;
}

/**
 * The view to show: the cook's stored choice, else the width's default.
 *
 * @param stored - The parsed choice.
 * @param container - The container class of the results.
 * @returns The view mode.
 */
export function viewModeOf(stored: ListViewMode | undefined, container: ContainerClass): ListViewMode {
    return stored ?? defaultViewModeOf(container);
}

/**
 * The `document.cookie` assignment that stores a choice for a year, site-wide.
 *
 * @param mode - The choice.
 * @returns The assignment.
 */
export function viewModeCookieFor(mode: ListViewMode): string {
    return `${VIEW_MODE_KEY}=${mode}; path=/; max-age=31536000; samesite=lax`;
}
