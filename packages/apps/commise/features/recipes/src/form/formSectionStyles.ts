/**
 * @module @commise/features-recipes/form — Tailwind class strings shared by MORE THAN ONE web recipe-form
 * field group (`RecipeBasicsFields`, `RecipeIngredientsFields`, `RecipeInstructionsFields`). A class string
 * used by exactly one group lives in that group's own file instead — this module holds only the chrome the
 * sections must keep identical (the card, its heading, the input, the error alert).
 */
export const sectionCard = 'flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-sm';
export const sectionHeading = 'font-display text-heading-md font-semibold text-charcoal';
export const field =
    'w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none focus:ring-2 focus:ring-seafoam';
export const rowField = `${field} min-w-0 flex-1`;
export const errorText = 'text-body-sm text-error-dark';
