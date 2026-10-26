/**
 * @module @commise/features-recipes/form — the contract `PasteMatchSummary`'s web and native leaves share.
 */
import type { PasteMatchSummaryView } from './pasteMatchView.js';

/** Props for `PasteMatchSummary`. */
export interface PasteMatchSummaryProps {
    /** What the summary says (`pasteMatchSummaryOf`). */
    readonly view: PasteMatchSummaryView;
}
