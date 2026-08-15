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
