/**
 * @module @commise/features-recipes/form — the contract the paste caption's web and native leaves share (ADR-0089).
 */

/** Props for `PastedSourceNotice`. */
export interface PastedSourceNoticeProps {
    /** What the paste did to the Source, in the words the live region speaks. */
    readonly text: string;
    /** Take the source off, in place. ABSENT for a note with nothing to undo (a link kept, left out or locked). */
    readonly onRemove?: () => void;
}
