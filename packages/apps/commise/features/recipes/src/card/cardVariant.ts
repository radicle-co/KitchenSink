/**
 * @module @commise/features-recipes/card — which `RecipeCard` variant a surface draws, and the library's default view.
 *
 * The space a card gets picks its variant, never the device (`docs/design/uiOverhaul/buildSpec.md` §4.1). Home follows
 * the owner's D8 ruling: compact cards below a 960 px container (2 × 2 on phones, one row of 4 on tablets) and the full
 * grid card from 960. The library follows the cook's own list/grid choice. Discover results are compact below a 600
 * container and grid cards from 600 (§4.5).
 *
 * Pure. The orchestration layer reads the container class and the stored view mode and hands the decided variant to the
 * render component, which never decides it.
 *
 * @pattern Policy — one rule over (container class, view mode, surface); render components receive the decided variant
 */
import type { ContainerClass } from '@commise/ui/container-class';

/** The three shapes of one card (§4.1). */
export type CardVariant = 'grid' | 'row' | 'compact';

/** The surfaces that draw recipe cards. */
export type CardSurface = 'home' | 'library' | 'discover';

/** The library's two presentations, in the order the view switch shows them. */
export const LIST_VIEW_MODES = ['list', 'grid'] as const;

/** One of the library's presentations. */
export type ListViewMode = (typeof LIST_VIEW_MODES)[number];

/**
 * Whether a stored value is a view mode. A device store or a cookie can hold anything, so it is parsed, not trusted.
 *
 * @param value - The stored value.
 * @returns `true` for `'list'` or `'grid'` exactly.
 */
export function isListViewMode(value: unknown): value is ListViewMode {
    return value === 'list' || value === 'grid';
}

/**
 * The variant a surface draws.
 *
 * @param container - The container class of the space the cards sit in.
 * @param viewMode - The library's list/grid choice. Home and Discover do not read it.
 * @param surface - The surface drawing the cards.
 * @returns The card variant.
 */
export function cardVariantOf(container: ContainerClass, viewMode: ListViewMode, surface: CardSurface): CardVariant {
    switch (surface) {
        case 'home':
            return container === 'wide' ? 'grid' : 'compact';
        case 'library':
            return viewMode === 'list' ? 'row' : 'grid';
        case 'discover':
            return container === 'narrow' ? 'compact' : 'grid';
    }
}

/**
 * The library's view before the cook has chosen one (§4.3): a list below a 600 container, a grid from 600.
 *
 * @param container - The container class of the library's results.
 * @returns The default view mode.
 */
export function defaultViewModeOf(container: ContainerClass): ListViewMode {
    return container === 'narrow' ? 'list' : 'grid';
}
