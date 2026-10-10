/**
 * @module @commise/features-recipes/form — the recipe form's `aria-describedby` contract (B8).
 *
 * Static ids for the singleton fields' error alerts — the element an invalid field's `aria-describedby`
 * points at. Ingredient/step ROWS build their own per-index ids at the point of use, since those sections
 * repeat; only the singletons need a stable, shared name.
 *
 * These are platform-NEUTRAL on purpose. The web leaves render them as DOM `id`s and the native leaves as
 * `<Text id=…>` (react-native-web maps both `id` and `aria-describedby` straight through to DOM attributes),
 * so the two platforms must agree on the literal strings — that agreement is one piece of knowledge and lives
 * here once rather than being spelled twice.
 */
export const titleErrorId = 'recipe-title-error';
export const servingsErrorId = 'recipe-servings-error';
export const timesErrorId = 'recipe-times-error';
export const ingredientsErrorId = 'recipe-ingredients-error';
export const stepsErrorId = 'recipe-steps-error';

/**
 * The id of ONE ingredient row's unit note — the `classifyUnit` verdict a non-canonical unit carries (U25).
 *
 * ⛔ PER ROW, which is why it is a function rather than a constant. A shared id would point every row's unit
 * field at the FIRST row's note, so a cook on row 7 would hear row 1's verdict — the repeat-section failure
 * the module docstring above warns about.
 *
 * @param index - The zero-based ingredient line index.
 * @returns The element id. Pure.
 */
export const ingredientUnitNoteId = (index: number): string => `recipe-ingredient-${index}-unit-note`;

/**
 * The id of one row editor's amount note ("Check the amount"), which describes both bounds while either holds text that
 * states no amount. By the line's key, like the editor's fields (`ingredientEditorFieldId`).
 *
 * @param key - The line's key.
 * @returns The element id. Pure.
 */
export const ingredientAmountNoteId = (key: string): string => `recipe-ingredient-${key}-amount-note`;

/**
 * The id of ONE ingredient row's "no food chosen" note (plan U28).
 *
 * ⛔ PER ROW, for the same reason {@link ingredientUnitNoteId} is: a shared id would point every unresolved
 * row's name field at the FIRST one's note. And it is deliberately NOT `ingredientsErrorId` — that is the
 * section's single form-level alert, which says the recipe cannot advance; this says which row and why.
 *
 * @param index - The zero-based ingredient line index.
 * @returns The element id. Pure.
 */
export const ingredientNoFoodNoteId = (index: number): string => `recipe-ingredient-${index}-no-food-note`;

/**
 * The id of the stand-in a row shows in its name's place when the line has no name (plan 002 R9). The chip is not a
 * field, so the row's first field names it as its description — a cook tabbing through the form still hears which
 * food the amount belongs to.
 */
export const ingredientStandInId = (index: number): string => `recipe-ingredient-${index}-stand-in`;

/**
 * The `aria-describedby` value for ONE ingredient row's NAME field (plan U28), or `undefined` when nothing
 * describes it. Pure — the ONE composition both platform leaves use, so they cannot describe the same row
 * differently.
 *
 * ⛔ BOTH ids when both apply, never either/or, and the order is part of the contract. They say different
 * things: {@link ingredientNoFoodNoteId} names WHICH row is missing a food and what to do about it, while
 * {@link ingredientsErrorId} is the section's single form-level alert saying the recipe cannot advance. A
 * screen-reader user who hears only the second is told the recipe is blocked without being told where.
 *
 * @param index - The zero-based ingredient line index.
 * @param hasNoFoodNote - Whether this row is rendering its "no food chosen" note.
 * @param hasUnresolvedError - Whether the section is showing the form-level `ingredientsUnresolved` alert.
 * @returns The space-separated id list, or `undefined` when neither applies.
 */
export const ingredientNameDescribedBy = (
    index: number,
    hasNoFoodNote: boolean,
    hasUnresolvedError: boolean,
): string | undefined => {
    const ids = [
        ...(hasNoFoodNote ? [ingredientNoFoodNoteId(index)] : []),
        ...(hasNoFoodNote && hasUnresolvedError ? [ingredientsErrorId] : []),
    ];

    return ids.length === 0 ? undefined : ids.join(' ');
};

/**
 * The `aria-describedby` value for ONE ingredient row's first QUANTITY field, or `undefined` when nothing describes
 * it. Pure — the one composition both platform leaves use.
 *
 * The stand-in comes first: on a row with no name it is the only statement of which food the amount belongs to, and
 * the quantity field is the first stop in the row's tab order.
 *
 * @param index - The zero-based ingredient line index.
 * @param hasStandIn - Whether the row shows a stand-in in its name's place.
 * @param quantityInvalid - Whether the section's quantity alert names this row.
 * @returns The space-separated id list, or `undefined` when neither applies.
 */
export const ingredientQuantityDescribedBy = (
    index: number,
    hasStandIn: boolean,
    quantityInvalid: boolean,
): string | undefined => {
    const ids = [...(hasStandIn ? [ingredientStandInId(index)] : []), ...(quantityInvalid ? [ingredientsErrorId] : [])];

    return ids.length === 0 ? undefined : ids.join(' ');
};

/** The id of one row's pending sentence: text a save refused (§4b; `docs/design/rowEditorOpenDecisions.md` item 4). */
export const ingredientPendingTextId = (key: string): string => `recipe-ingredient-${key}-pending-text`;

/** The id of one row's failed pick or refused details write (items 1 and 4; `ingredientSpecialization.md` §S8.9). */
export const ingredientCommitFailureId = (key: string): string => `recipe-ingredient-${key}-commit-failure`;

/** What an entry field's row says about it. */
export interface IngredientEntryNotes {
    /** The row names no food, and wears the note. */
    readonly noFoodNote: boolean;
    /** The form refused a save for unresolved lines (`ingredientsUnresolved`). */
    readonly unresolvedError: boolean;
    /** The field holds text a save refused. */
    readonly pending: boolean;
    /** A pick on the row failed. */
    readonly failure: boolean;
}

/**
 * The `aria-describedby` value for one row's ENTRY field, or `undefined` when nothing describes it. Pure — the one
 * composition both platform leaves use: the record field's notes, then the pending sentence, then the failure.
 *
 * @param index - The zero-based ingredient line index.
 * @param key - The line's key.
 * @param notes - What the row says.
 * @returns The ids, space-separated.
 */
export const ingredientEntryDescribedBy = (
    index: number,
    key: string,
    notes: IngredientEntryNotes,
): string | undefined => {
    const ids = [
        ...(ingredientNameDescribedBy(index, notes.noFoodNote, notes.unresolvedError)?.split(' ') ?? []),
        ...(notes.pending ? [ingredientPendingTextId(key)] : []),
        ...(notes.failure ? [ingredientCommitFailureId(key)] : []),
    ];

    return ids.length === 0 ? undefined : ids.join(' ');
};

/** The trailing add row's part of an id: a line key never spells it (`isIngredientLineKey`), so no row's id is equal. */
const TRAILING_ID_PART = 'newLine';

/** The id of the trailing add row's pending sentence (§4b, `docs/design/rowEditorOpenDecisions.md` R7). */
export const trailingPendingTextId = ingredientPendingTextId(TRAILING_ID_PART);

/** The id of the trailing add row's failed pick (item 1). */
export const trailingCommitFailureId = ingredientCommitFailureId(TRAILING_ID_PART);

/**
 * The `aria-describedby` value for the trailing add row's field, or `undefined` when nothing describes it: its pending
 * sentence, then its failure, as a row's entry field (`ingredientEntryDescribedBy`). Pure.
 *
 * @param notes - What the trailing row says.
 * @returns The ids, space-separated.
 */
export const trailingEntryDescribedBy = (
    notes: Pick<IngredientEntryNotes, 'pending' | 'failure'>,
): string | undefined => {
    const ids = [
        ...(notes.pending ? [trailingPendingTextId] : []),
        ...(notes.failure ? [trailingCommitFailureId] : []),
    ];

    return ids.length === 0 ? undefined : ids.join(' ');
};
