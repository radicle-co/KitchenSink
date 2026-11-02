/**
 * @module @commise/ui/create-fab — the system text scale the floating button's label and its end room are both drawn
 * at, read from the context the design-system Text reads, so the button and the room cannot disagree.
 */
import { TextScaleContext } from '../text/textScaleContext.native.js';

/** @returns The system text scale the design system draws its text at. */
export function useFabTextScale(): number {
    return TextScaleContext.useStyledContext().textScale;
}
