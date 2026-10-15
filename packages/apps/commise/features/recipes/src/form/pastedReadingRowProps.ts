/**
 * @module @commise/features-recipes/form — the contract `PastedReadingRow`'s web and native leaves share.
 */
import type { PasteReadingRow } from './props.js';

/** Props for `PastedReadingRow`. */
export interface PastedReadingRowProps {
    /** The pasted line, its position in the paste, and what it is doing. */
    readonly row: PasteReadingRow;
    /** Ask again for the line whose lookup failed; absent, a failed row offers no Try again. */
    readonly onRetryLookup: (() => void) | undefined;
    /** Add a line as the cook wrote it, by its `lineIndex`; absent, a waiting row offers no way out. */
    readonly onAddAsWritten: ((lineIndex: number) => void) | undefined;
}
