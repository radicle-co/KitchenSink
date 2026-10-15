/**
 * @module @commise/features-recipes/form — the contract `PasteProgressBlock`'s web and native leaves share.
 */
import type { PasteProgress } from './props.js';

/** Props for `PasteProgressBlock`. */
export interface PasteProgressBlockProps {
    /** The paste's count, the step it is at, and what its actions would cover (`pasteProgressOf`). */
    readonly progress: PasteProgress;
    /** Re-drive every retryable line of the paste. */
    readonly onRetryParse: () => void;
    /** Add every stalled and retryable line as written. */
    readonly onAddRestAsWritten: () => void;
    /** Moves when the cook acted on the paste: focus goes to the block if the control that had it went away. */
    readonly focusSignal: number;
}
