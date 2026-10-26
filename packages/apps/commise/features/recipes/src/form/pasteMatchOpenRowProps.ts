/**
 * @module @commise/features-recipes/form — the contract `PasteMatchOpenRow`'s web and native leaves share: the one open
 * pasted line on phone and 834.
 */
import type { FoodChoiceListProps } from './foodChoiceListProps.js';
import type { PastedLineText } from './pasteMatchLine.js';

/** Props for `PasteMatchOpenRow`: the line, and its list's view and controls (`FoodChoiceList`). */
export interface PasteMatchOpenRowProps extends FoodChoiceListProps {
    /** The line as the cook wrote it. */
    readonly line: PastedLineText;
}
