/**
 * @module cookingScaleNoteProps — the props of the scale note, on web and native: the sentence that says the steps give
 * amounts for another serving count, and the one button that opens the ingredients. The screen decides, per
 * `layoutBand`, whether there is something to open: `onOpen` is absent when there is not, and then no button is drawn.
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
