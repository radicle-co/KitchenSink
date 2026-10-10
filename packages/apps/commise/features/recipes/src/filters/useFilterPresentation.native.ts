/**
 * @module @commise/features-recipes/filters — which place Discover's facets take, on native: the same
 * `filterPresentationOf` over the screen's container class and whether the window is short
 * (`docs/architecture/uiOverhaulBlueprint.md` Part C, slice 5). A phone is `narrow` and a tablet held wide has the room for
 * the panel; a tablet turned short does not.
 *
 * @pattern Adapter over React Native's window dimensions — the `filterPresentationOf` Policy, kept current
 */
import { useCompactHeight } from '@commise/ui/layout';

import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { filterPresentationOf, type FilterPresentation } from './filterPresentation.js';

/**
 * Where Discover's facets live for the current window.
 *
 * @returns `'panel'` or `'sheet'`.
 */
export function useFilterPresentation(): FilterPresentation {
    return filterPresentationOf(useMainContainerClass(), useCompactHeight());
}
