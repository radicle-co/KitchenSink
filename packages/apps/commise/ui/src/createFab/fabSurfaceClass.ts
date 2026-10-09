/**
 * @module @commise/ui/create-fab — the web floating create control's surface, as classes: solid `action` at level 3,
 * fixed at the bottom trailing corner 16 px above the bottom chrome (`--bottom-chrome`, the tab bar's height, set by the
 * app shell), 16 px in on phones and 24 on tablets, gone from `nav` (840) where the sidebar holds it. The `CreateFab`
 * and the interim create dial's trigger both draw it.
 */
import type { FabPresentation } from './createFabPolicy.js';

/**
 * @param presentation - `icon` (a 56 px disc) or `extended` (a 56 px pill with the label).
 * @returns The trigger's classes. Pure.
 */
export function fabSurfaceClass(presentation: Exclude<FabPresentation, 'hidden'>): string {
    const shape = presentation === 'icon' ? 'size-14 justify-center' : 'h-14 gap-2 pe-6 ps-4';

    return `fixed bottom-[calc(var(--bottom-chrome,0px)+1rem)] end-4 z-40 inline-flex items-center rounded-full bg-action text-label text-on-action shadow-lg transition-colors hover:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 medium:end-6 nav:hidden ${shape}`;
}
