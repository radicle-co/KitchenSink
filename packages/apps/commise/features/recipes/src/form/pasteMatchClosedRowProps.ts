/**
 * @module @commise/features-recipes/form — the contract `PasteMatchClosedRow`'s web and native leaves share: an open
 * pasted line drawn collapsed.
 */
import type { PastedLineText } from './pasteMatchLine.js';
import type { PasteMatchClosedView } from './pasteMatchView.js';

/** Props for `PasteMatchClosedRow`. */
export interface PasteMatchClosedRowProps {
    /** The line as the cook wrote it. */
    readonly line: PastedLineText;
    /** What the line needs (`pasteMatchClosedViewOf`). */
    readonly view: PasteMatchClosedView;
    /** The side pane shows this line (1194 and web): it is marked current. Display only; the row does the same thing. */
    readonly current: boolean;
    /** The row was pressed: open this line. */
    readonly onOpen: () => void;
}
