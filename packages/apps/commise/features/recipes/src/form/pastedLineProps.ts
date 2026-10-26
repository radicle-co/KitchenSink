/**
 * @module @commise/features-recipes/form — the contract `PastedLine`'s web and native leaves share.
 */
import type { PastedLineText } from './pasteMatchLine.js';

/** Props for `PastedLine`. */
export interface PastedLineProps {
    /** The line as the cook wrote it: its measure and its words. */
    readonly line: PastedLineText;
}
