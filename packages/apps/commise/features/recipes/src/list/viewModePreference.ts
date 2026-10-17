/**
 * @module @commise/features-recipes/list — which view the library shows. The cook's choice is an ACCOUNT setting
 * (`recipeViewMode`, ADR-0059, owner ruling 2026-10-17), read and written by the host through `useRecipeViewSetting`;
 * it used to be a cookie on web and a device-store value on native, and both are gone. Until the cook chooses, the width
 * picks (`defaultViewModeOf`), and that default is never stored, so a phone's default does not pin a later wide screen.
 *
 * Pure.
 */
import type { ContainerClass } from '@commise/ui/container-class';

import { defaultViewModeOf, type ListViewMode } from '../card/cardVariant.js';

/**
 * The view to show: the cook's stored choice, else the width's default.
 *
 * @param stored - The cook's choice, or `undefined` when they never made one.
 * @param container - The container class of the results.
 * @returns The view mode.
 */
export function viewModeOf(stored: ListViewMode | undefined, container: ContainerClass): ListViewMode {
    return stored ?? defaultViewModeOf(container);
}
