/**
 * @module cookingScaleNoteProps — the props of the scale note, on web and native: the sentence that says the steps give
 * amounts for another serving count, and the one button that opens the ingredients. Native leaves `onOpen` out
 * at two columns, where there is nothing to open, and then no button is drawn. Web always passes `onOpen` and CSS
 * hides the button at two columns.
 */

/** What `CookingScaleNote` (web and native) is given. */
export interface CookingScaleNoteProps {
    /** The note, already filled with both serving counts (`view.scaleNote`). */
    readonly note: string;
    /** The button's visible text and its accessible name (`cooking.step.scaleNoteOpen`). */
    readonly openLabel: string;
    /** Open the ingredients. Absent: the note stands alone, with no button. */
    readonly onOpen?: () => void;
}
