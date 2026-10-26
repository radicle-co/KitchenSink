/**
 * @module @commise/features-recipes/form — the contract `PasteMatchRow`'s web and native leaves share: a pasted line that
 * needs nothing from the cook now.
 */
import type { PastedLineText } from './pasteMatchLine.js';
import type { PasteMatchAction, PasteMatchRowView } from './pasteMatchView.js';

/** Props for `PasteMatchRow`. */
export interface PasteMatchRowProps {
    /** The line as the cook wrote it. */
    readonly line: PastedLineText;
    /** What the line shows (`pasteMatchRowViewOf`). */
    readonly view: PasteMatchRowView;
    /** One of the line's controls was pressed, by its kind. */
    readonly onAction: (action: PasteMatchAction['kind']) => void;
    /** See why, after a late review result. */
    readonly onSeeWhy: () => void;
}
