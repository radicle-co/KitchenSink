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
