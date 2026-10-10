/**
 * @module @commise/features-recipes/form — the contract `PastedReadingRow`'s web and native leaves share.
 */
import type { PasteReadingRow } from './props.js';

/** Props for `PastedReadingRow`. */
export interface PastedReadingRowProps {
    readonly row: PasteReadingRow;
    /** Ask again for the line whose lookup failed; absent, the failed row offers no Try again. */
    readonly onRetry: (() => void) | undefined;
}
