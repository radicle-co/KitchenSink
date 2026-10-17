/**
 * @module @commise/features-recipes/filters — where Discover's facets live (`docs/design/uiOverhaul/buildSpec.md` §4.4;
 * `docs/architecture/uiOverhaulBlueprint.md` Part C, slice 5).
 *
 * A sticky 256 px panel beside the results when the content is at least 960 wide AND the window is not short; otherwise
 * a sheet behind a Filters button. The two are never both drawn, so there is one facet tree on screen and one set of
 * names for assistive technology to find. This replaces the web-only media query `useFilterBarLayout` held: the answer
 * now comes from the container class both platforms already share, so a phone held sideways and a narrow window agree.
 *
 * Pure. The container reads the container class and the window, and hands the decided presentation to the render
 * components, which never decide it.
 *
 * @pattern Policy — one rule over (container class, window height); render components receive the decided presentation
 */
import type { ContainerClass } from '@commise/ui/container-class';

/** The two places the facets can live. */
export type FilterPresentation = 'panel' | 'sheet';

/**
 * Where the facets live.
 *
 * @param container - The container class of the screen's content.
 * @param compactHeight - Whether the window is under 480 tall (`isCompactHeight`).
 * @returns `'panel'` for a wide container in a window that is not short, else `'sheet'`.
 */
export function filterPresentationOf(container: ContainerClass, compactHeight: boolean): FilterPresentation {
    return container === 'wide' && !compactHeight ? 'panel' : 'sheet';
}
