/**
 * @module @commise/ui/create-fab — the web floating create control's surface, as classes: solid `action` at level 3,
 * fixed at the bottom trailing corner 16 px above the bottom chrome (`--bottom-chrome`, the tab bar's height, set by the
 * app shell), 16 px in on phones and 24 on tablets, gone from `nav` (840) where the sidebar holds it. The `CreateFab`
 * draws it. The `bottom` offset is not a class: it moves when a snackbar shows, so {@link fabBottomOf} gives it as a value.
 */
import type { FabPresentation } from './createFabPolicy.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

/**
 * @param presentation - `icon` (a 56 px disc) or `extended` (a 56 px pill with the label).
 * @returns The trigger's classes. Pure.
 */
export function fabSurfaceClass(presentation: Exclude<FabPresentation, 'hidden'>): string {
    const shape = presentation === 'icon' ? 'size-14 justify-center' : 'h-14 gap-2 pe-6 ps-4';

    return `fixed end-4 z-40 inline-flex items-center rounded-full bg-action text-label text-on-action shadow-lg transition-colors hover:bg-action-pressed ${FOCUS_RING_CLASS.floating} medium:end-6 nav:hidden ${shape}`;
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
