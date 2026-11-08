/**
 * @module @commise/features-recipes/form — the contract `PasteMatchedBlock`'s web and native leaves share: the paste's
 * matched lines with their summary and notice.
 */
import type { PasteMatchingView } from './props.js';

/** Props for `PasteMatchedBlock`. */
export interface PasteMatchedBlockProps {
    /** The matched lines and what stands around them (`usePasteMatchView`). */
    readonly matching: PasteMatchingView;
    /** The container class is the wide one: the side pane stands beside the list. */
    readonly wide: boolean;
}
