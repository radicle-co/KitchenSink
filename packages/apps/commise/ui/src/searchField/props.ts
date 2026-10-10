/**
 * @module @commise/ui/search-field — the shared contract of the design-system `SearchField`
 * (`docs/architecture/uiOverhaulBlueprint.md` Part B; `docs/design/uiOverhaul/buildSpec.md` §1.11): the one pill input.
 *
 * A search field always has a label — shown above it, or visually hidden but still its name; never a placeholder
 * standing in for one. A non-empty field shows a clear control, and clearing returns focus to the field.
 *
 * ⚠️ `clearLabel` is not in the blueprint's contract. The clear control's name ("Clear search") is user-facing copy and
 * `@commise/ui` holds no message catalogue, so the screen supplies it from its own localised messages.
 */

/** Whether the label is drawn above the field or kept only as its accessible name. */
export type SearchLabelVisibility = 'visible' | 'hidden';

/** The cross-platform `SearchField` contract. */
export interface SearchFieldProps {
    /** The field's id. Unique on the page. */
    readonly id: string;
    /** The field's label: its accessible name, and its visible label when {@link labelVisibility} is `visible`. */
    readonly label: string;
    /** Draw the label above the field, or keep it as the name only. */
    readonly labelVisibility: SearchLabelVisibility;
    /** The localised name of the clear control (e.g. "Clear search"). */
    readonly clearLabel: string;
    /** The controlled query. */
    readonly value: string;
    /** Called with the new query on each edit, and with `''` when cleared. */
    readonly onChangeText: (text: string) => void;
    /** Called when the person presses the keyboard's search key. */
    readonly onSubmit?: () => void;
    /** An example query, never a label. */
    readonly placeholder?: string;
    /** Called when the field takes focus (a screen shows its idle-state panel, such as recent searches, only then). */
    readonly onFocus?: () => void;
    /** Called when the field loses focus. */
    readonly onBlur?: () => void;
}
