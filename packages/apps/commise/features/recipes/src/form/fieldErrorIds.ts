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
