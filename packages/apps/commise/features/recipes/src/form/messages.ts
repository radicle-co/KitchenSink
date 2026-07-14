/**
 * @module @commise/features-recipes/form/messages — user-facing copy for the recipe create/edit form
 * (T067). Its own {@link LocalizedMessages} dictionary (mirroring the shape of `../messages.ts`), exported
 * once and consumed by BOTH the web `RecipeForm.tsx` and native `RecipeForm.native.tsx` leaves via
 * `useMessages`, so the platforms cannot drift on copy. The `en` set is required; adding a locale is just
 * another key. Templates carry `{token}` placeholders filled with `fillTemplate`.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe create/edit form, rendered by both the web and native form leaves. */
export interface RecipeFormMessages {
    /** Heading shown in create mode. */
    readonly createHeading: string;
    /** Heading shown in edit mode. */
    readonly editHeading: string;
    /** Submit-button label in create mode. */
    readonly createSubmit: string;
    /** Submit-button label in edit mode. */
    readonly editSubmit: string;
    /** Cancel/dismiss action label. */
    readonly cancel: string;

    /** Heading for the basics section. */
    readonly basicsHeading: string;
    /** Accessible label for the title field. */
    readonly titleLabel: string;
    /** Placeholder shown inside the title field. */
    readonly titlePlaceholder: string;
    /** Accessible label for the description field. */
    readonly descriptionLabel: string;
    /** Accessible label for the cuisine field. */
    readonly cuisineLabel: string;
    /** Accessible label for the tags field. */
    readonly tagsLabel: string;
    /** Hint explaining the comma-separated entry for tags. */
    readonly tagsHint: string;
    /** Accessible label for the dietary-flags field. */
    readonly dietaryFlagsLabel: string;
    /** Accessible label for the servings field. */
    readonly servingsLabel: string;
    /** Accessible label for the prep-time field. */
    readonly prepTimeLabel: string;
    /** Accessible label for the cook-time field. */
    readonly cookTimeLabel: string;
    /** Label for the read-only computed total-time value. */
    readonly totalTimeLabel: string;
    /** Total-time unit template (contains `{minutes}`). */
    readonly durationMinutes: string;

    /** Heading for the ingredients section. */
    readonly ingredientsHeading: string;
    /** Ingredient-name field label template (contains `{number}`). */
    readonly ingredientNameLabel: string;
    /** Ingredient-quantity field label template (contains `{number}`). */
    readonly ingredientQuantityLabel: string;
    /** Ingredient-unit field label template (contains `{number}`). */
    readonly ingredientUnitLabel: string;
    /** Accessible label for an ingredient line's resolution-status badge (contains `{number}`). */
    readonly ingredientStatusLabel: string;
    /** Add-ingredient action label. */
    readonly addIngredient: string;
    /** Remove-ingredient action label template (contains `{number}`). */
    readonly removeIngredient: string;
    /** Empty-state copy shown when there are no ingredient lines yet. */
    readonly noIngredients: string;

    /** Resolution-status badge: awaiting resolution. */
    readonly statusPending: string;
    /** Resolution-status badge: not yet resolved. */
    readonly statusUnresolved: string;
    /** Resolution-status badge: resolved to a catalog item. */
    readonly statusResolved: string;
    /** Resolution-status badge: no catalog match found. */
    readonly statusNotFound: string;
    /** Resolution-status badge: resolution failed. */
    readonly statusFailed: string;

    /** Heading for the instructions section. */
    readonly stepsHeading: string;
    /** Step-instruction field label template (contains `{number}`). */
    readonly stepInstructionLabel: string;
    /** Step-timer field label template (contains `{number}`). */
    readonly stepTimerLabel: string;
    /** Add-step action label. */
    readonly addStep: string;
    /** Remove-step action label template (contains `{number}`). */
    readonly removeStep: string;
    /** Empty-state copy shown when there are no instruction steps yet. */
    readonly noSteps: string;

    /** Accessible label for the private-visibility toggle. */
    readonly visibilityLabel: string;
}

export const recipeFormMessages: LocalizedMessages<RecipeFormMessages> = {
    en: {
        createHeading: 'New recipe',
        editHeading: 'Edit recipe',
        createSubmit: 'Create recipe',
        editSubmit: 'Save changes',
        cancel: 'Cancel',

        basicsHeading: 'Basics',
        titleLabel: 'Title',
        titlePlaceholder: 'e.g. Weeknight Pasta',
        descriptionLabel: 'Description',
        cuisineLabel: 'Cuisine',
        tagsLabel: 'Tags',
        tagsHint: 'Separate tags with commas',
        dietaryFlagsLabel: 'Dietary flags',
        servingsLabel: 'Servings',
        prepTimeLabel: 'Prep time (minutes)',
        cookTimeLabel: 'Cook time (minutes)',
        totalTimeLabel: 'Total time',
        durationMinutes: '{minutes} min',

        ingredientsHeading: 'Ingredients',
        ingredientNameLabel: 'Ingredient {number} name',
        ingredientQuantityLabel: 'Ingredient {number} quantity',
        ingredientUnitLabel: 'Ingredient {number} unit',
        ingredientStatusLabel: 'Ingredient {number} status',
        addIngredient: 'Add ingredient',
        removeIngredient: 'Remove ingredient {number}',
        noIngredients: 'No ingredients yet. Add your first ingredient.',

        statusPending: 'Resolving…',
        statusUnresolved: 'Not resolved',
        statusResolved: 'Resolved',
        statusNotFound: 'No match found',
        statusFailed: 'Resolution failed',

        stepsHeading: 'Instructions',
        stepInstructionLabel: 'Step {number} instruction',
        stepTimerLabel: 'Step {number} timer (seconds)',
        addStep: 'Add step',
        removeStep: 'Remove step {number}',
        noSteps: 'No steps yet. Add your first step.',

        visibilityLabel: 'Private recipe',
    },
};
