/**
 * @module @commise/features-recipes/form — the ids the one-page editor's Details and Steps fields carry: each field's
 * own id (its `FieldLabel`'s target, the native `nativeID`), and the ids of the counters that describe a field. Both
 * platform leaves read them from here, so a label and its field cannot be paired by two spellings. The error messages'
 * ids are `./fieldErrorIds.ts`'s.
 *
 * Pure and platform-agnostic.
 */

export const titleFieldId = 'recipe-title';
export const titleCounterId = 'recipe-title-counter';
export const descriptionFieldId = 'recipe-description';
export const descriptionCounterId = 'recipe-description-counter';
export const servingsFieldId = 'recipe-servings';
export const cuisineFieldId = 'recipe-cuisine';
export const tagsFieldId = 'recipe-tags';
export const dietaryFlagsFieldId = 'recipe-dietary-flags';

/**
 * A step's instruction field. Pure.
 *
 * @param index - The step's index in the draft.
 * @returns The id.
 */
export const stepFieldId = (index: number): string => `recipe-step-${String(index)}`;

/** The paste-steps sheet's field. */
export const pasteStepsFieldId = 'recipe-paste-steps';

/** The Paste a list sheet's field. */
export const pasteListFieldId = 'recipe-paste-list';

/**
 * The ids that describe a field, space-separated, or `undefined` for none: a field's `describedBy` when a message and a
 * counter may each be shown. Pure.
 *
 * @param ids - Each id, or `undefined` where that part is not shown.
 * @returns The `aria-describedby` value.
 */
export const describedByOf = (...ids: readonly (string | undefined)[]): string | undefined => {
    const shown = ids.filter((id): id is string => id !== undefined);

    return shown.length === 0 ? undefined : shown.join(' ');
};

/** The row editor's fields (build spec §7.5.2). */
export type IngredientEditorField = 'amount' | 'amountHigh' | 'unit' | 'prep';

/**
 * One row editor field's id, by its line's key, so two rows never share a label target. Pure.
 *
 * @param key - The line's key.
 * @param field - The field.
 * @returns The id.
 */
export const ingredientEditorFieldId = (key: string, field: IngredientEditorField): string =>
    `recipe-ingredient-${key}-${field}`;

/** The inline group-name field (build spec §7.5.5: "+ Add a group" and Rename group). */
export const groupNameFieldId = 'recipe-ingredient-group-name';
