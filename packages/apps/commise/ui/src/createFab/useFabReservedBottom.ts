/**
 * @module @commise/ui/create-fab — web sibling of `useFabReservedBottom.native`. The web reserves the room in CSS
 * (`--fab-reserved-bottom`, rem), which scales with the root font size together with the button's rem height, so
 * this answers the scale-1 value for a shared screen that asks.
 */
import { FAB_RESERVED_BOTTOM_PX } from './createFabPolicy.js';

/** @returns The room under the floating button, px, at the root font size. */
export function useFabReservedBottom(): number {
    return FAB_RESERVED_BOTTOM_PX;
}
