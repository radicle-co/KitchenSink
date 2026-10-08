/**
 * @module @commise/features-recipes/form — Tailwind class strings shared by MORE THAN ONE web recipe-form
 * field group (`RecipeBasicsFields`, `RecipeIngredientsFields`, `RecipeInstructionsFields`). A class string
 * used by exactly one group lives in that group's own file instead — this module holds only the chrome the
 * sections must keep identical (the card, its heading, the input, the error alert).
 */
export const sectionCard = 'flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-sm';
export const sectionHeading = 'font-display text-heading-md font-semibold text-charcoal';
/**
 * The input chrome with NO width and NO text colour: the base for a field that states either itself.
 *
 * ⛔ Never layer a `w-*` (or a `text-*` colour) on {@link field}. Both land in the class attribute, and the stylesheet's
 * EMISSION order decides, not the order written: `.w-full` is emitted after `.w-24`/`.w-28`/`.w-40`/`.w-48`, so it won
 * on every sized row field (V1 sign-off W-1; the same class as the invisible difficulty chip). Build sized fields from
 * this string instead.
 */
export const fieldChrome =
    'rounded-lg border border-border bg-white px-3 py-2 text-body-md outline-none focus:ring-2 focus:ring-seafoam';
/** A full-width charcoal field: the default input. */
export const field = `w-full ${fieldChrome} text-charcoal`;
/** A field whose caller states its width, in charcoal. */
export const sizedField = `${fieldChrome} text-charcoal`;
export const errorText = 'text-body-sm text-error-dark';
