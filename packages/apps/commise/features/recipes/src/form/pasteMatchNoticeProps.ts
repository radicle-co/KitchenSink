/**
 * @module @commise/features-recipes/form — the contract `PasteMatchNotice`'s web and native leaves share.
 */
import type { PasteMatchNotice } from './pasteMatchLine.js';

/** Props for the `PasteMatchNotice` leaves. */
export interface PasteMatchNoticeProps {
    /** Offline (with where the draft is kept), or the daily limit (with when it resets). */
    readonly notice: PasteMatchNotice;
}
