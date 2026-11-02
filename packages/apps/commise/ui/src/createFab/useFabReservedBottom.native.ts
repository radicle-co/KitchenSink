/**
 * @module @commise/ui/create-fab — the room a native screen leaves at its foot for the floating button: the button's
 * drawn height at the current text scale, its margin and 16 (`fabReservedBottomOf`). The scale is read from the same
 * context the label's Text reads, so the room and the button cannot disagree.
 *
 * @pattern Policy — `createFabPolicy` decides, this hook only supplies the text scale
 */
import { TextScaleContext } from '../text/textScaleContext.native.js';
import { fabHeightAt, fabReservedBottomOf } from './createFabPolicy.js';

/** @returns The system text scale the design system draws its text at. */
export function useFabTextScale(): number {
    return TextScaleContext.useStyledContext().textScale;
}

/** @returns The bottom padding, px, that clears the floating button at the current text scale. */
export function useFabReservedBottom(): number {
    return fabReservedBottomOf(fabHeightAt(useFabTextScale()));
}
