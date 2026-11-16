/**
 * @module text/useTextScale — the system text scale the design system draws its text at, read from the context its
 * Text reads. Anything sized beside text (a check box, a hairline inset, a floating button) reads it here, so it
 * cannot disagree with the text. Native only.
 */
import { TextScaleContext } from './textScaleContext.native.js';

/** @returns The system text scale the design system draws its text at. */
export function useTextScale(): number {
    return TextScaleContext.useStyledContext().textScale;
}
