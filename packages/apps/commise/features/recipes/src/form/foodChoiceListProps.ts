/**
 * @module @commise/features-recipes/form — the contract `FoodChoiceList`'s web and native leaves share: the list an open
 * pasted line shows, inline on phone and 834 and in the side pane at 1194 and on web.
 */
import type { PasteMatchOpenView } from './pasteMatchView.js';

/** Props for `FoodChoiceList`. */
export interface FoodChoiceListProps {
    /** What the line offers (`pasteMatchOpenViewOf`): search, the options, Keep as written. Its prompt is the host's. */
    readonly view: PasteMatchOpenView;
    /** Search for a food was pressed. */
    readonly onSearch: () => void;
    /** A food was pressed: the pick, by the food's id. */
    readonly onChoose: (foodId: string) => void;
    /** Keep as written was pressed. */
    readonly onKeepAsWritten: () => void;
    /** Raised while Search for a food should take focus (after the pick on the line before, staff-ux 2026-10-25). */
    readonly searchFocusRequested: boolean;
    /** Search took the focus it was asked for; lowers the request. */
    readonly onSearchFocusRequestHandled: (() => void) | undefined;
}
