/**
 * @module @commise/ui/create-fab — the web floating create control's surface, as classes: solid `action` at level 3,
 * fixed at the bottom trailing corner 16 px above the bottom chrome (`--bottom-chrome`, the tab bar's height, set by the
 * app shell), 16 px in on phones and 24 on tablets, gone from `nav` (840) where the sidebar holds it. It floats only from
 * `FAB_FLOATS_FROM_HEIGHT_PX` of viewport height, through the theme's `fab-floats` variant; shorter, it is an inline
 * control on its own row under the page header, after the greeting and the date (designer ruling, 438f7e542): start-aligned,
 * 16 below, in normal flow and with no shadow, and never at the end of the H1 row, where the profile button sits. The `CreateFab` draws it. The `bottom` offset is not a class: it moves when a snackbar shows, so {@link fabBottomOf} gives it as a value.
 */
import type { FabPresentation } from './createFabPolicy.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

/**
 * @param presentation - `icon` (a 56 px disc) or `extended` (a 56 px pill with the label).
 * @returns The trigger's classes. Pure.
 */
export function fabSurfaceClass(presentation: Exclude<FabPresentation, 'hidden'>): string {
    const shape = presentation === 'icon' ? 'size-14 justify-center' : 'h-14 gap-2 pe-6 ps-4';

    return `fab-floats:fixed fab-floats:end-4 fab-floats:z-40 fab-floats:mt-0 fab-floats:shadow-lg fab-floats:medium:end-6 col-span-3 mt-4 inline-flex items-center justify-self-start rounded-full bg-action text-label text-on-action transition-colors hover:bg-action-pressed ${FOCUS_RING_CLASS.floating} nav:hidden ${shape}`;
}

/**
 * The button's `bottom` offset: its margin above the bottom chrome (`--fab-bottom-margin`, the theme's copy of
 * `FAB_BOTTOM_MARGIN_PX`), plus however far it rises to clear a snackbar.
 *
 * @param lift - The rise from `fabLiftOver`, px; `0` when no snackbar shows.
 * @returns A CSS length. Pure.
 */
export function fabBottomOf(lift: number): string {
    return `calc(var(--bottom-chrome,0px) + var(--fab-bottom-margin) + ${String(lift)}px)`;
}
