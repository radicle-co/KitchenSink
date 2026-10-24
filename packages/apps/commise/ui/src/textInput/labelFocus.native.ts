/**
 * @module @commise/ui/text-input — the fields a native `FieldLabel` can focus, by the id it names (React Native only).
 *
 * A web `<label for>` focuses its field when pressed. React Native has no label element and no lookup by id, so every
 * field rendered through `@commise/ui/text-input` with a `nativeID` registers itself here while mounted, and a pressed
 * label asks for the field under the id it names. A label whose field is not mounted does nothing.
 *
 * @pattern Registry — field id → the mounted field, filled and emptied by the fields themselves
 */

/** What a label can do to a field: give it the keyboard focus. */
export interface LabelFocusTarget {
    focus(): void;
}

/** The mounted fields, by id. One field per id: an id is unique on the screen. */
const fields = new Map<string, LabelFocusTarget>();

/**
 * Register a mounted field under its id.
 *
 * @param id - The field's `nativeID`.
 * @param field - The mounted field.
 * @returns The unregistration, which removes the entry only while it is still this field's, so a field that remounted
 *     under the same id is not removed by its predecessor's late cleanup.
 * @sideEffect Writes the module's registry.
 */
export function registerLabelledField(id: string, field: LabelFocusTarget): () => void {
    fields.set(id, field);

    return () => {
        if (fields.get(id) === field) {
            fields.delete(id);
        }
    };
}

/**
 * Focus the field registered under an id, if one is mounted.
 *
 * @param id - The id the label names.
 * @sideEffect Moves the keyboard focus.
 */
export function focusLabelledField(id: string): void {
    fields.get(id)?.focus();
}
