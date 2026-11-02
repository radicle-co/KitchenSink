/**
 * @module @commise/ui/create-fab — the room a native screen leaves at its foot for the floating button: the button's
 * drawn height at the current text scale, its margin and 16 (`fabReservedBottomOf`).
 *
 * @pattern Policy — `createFabPolicy` decides, this hook only supplies the text scale
 */
import { fabHeightAt, fabReservedBottomOf } from './createFabPolicy.js';
import { useFabTextScale } from './useFabTextScale.native.js';

/** @returns The bottom padding, px, that clears the floating button at the current text scale. */
export function useFabReservedBottom(): number {
    return fabReservedBottomOf(fabHeightAt(useFabTextScale()));
}
