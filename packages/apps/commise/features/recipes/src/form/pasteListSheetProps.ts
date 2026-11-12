/**
 * @module @commise/features-recipes/form — the contract the Paste a list sheet's web and native leaves share.
 */
import type { PasteListSheet } from '../editor/usePasteListSheet.js';

/** Props for `PasteListSheet`. */
export interface PasteListSheetProps {
    /** The sheet's state (`usePasteListSheet`). */
    readonly sheet: PasteListSheet;
    /** The parse job is being created: the primary reads busy. */
    readonly submitting: boolean;
    /** The job could not be created: said as an alert, and the text stays. */
    readonly failed: boolean;
    /**
     * Whether the Source can still be set (ADR-0089), so the hint says a link may be pasted too. Paste a list is offered
     * only until the first publish, so this is false only for a source that cannot be corrected (a book, a clone's).
     * Display only.
     */
    readonly offersSource?: boolean;
}
