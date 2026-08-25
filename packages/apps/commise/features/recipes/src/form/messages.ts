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
    /** Live character-counter template shown under title/description (contains `{count}`, `{max}`; w3/e6). */
    readonly charCounterTemplate: string;
    /** Accessible label for the cuisine field. */
    readonly cuisineLabel: string;
    /** The cuisine dropdown/picker's explicit "no cuisine stated" option label (w3/e5). */
    readonly cuisineUnsetOption: string;
    /** Group label for the difficulty radio group (FR-001b). */
    readonly difficultyLabel: string;
    /** Difficulty option: easy. */
    readonly difficultyEasy: string;
    /** Difficulty option: medium. */
    readonly difficultyMedium: string;
    /** Difficulty option: hard. */
    readonly difficultyHard: string;
    /** Difficulty option that clears a stated difficulty back to "not stated". */
    readonly difficultyNotStated: string;
    /** Accessible label for the tags field. */
    readonly tagsLabel: string;
    /** Placeholder/hint for the tags + dietary chip inputs — explains the type-and-enter entry (U6). */
    readonly tagsHint: string;
    /** Accessible label template for a chip's remove control (contains `{value}`; U6). */
    readonly removeChipLabel: string;
    /** Accessible label template for the native chip input's Add control (contains `{field}`; U6). */
    readonly addChipLabel: string;
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
    /**
     * Ingredient-quantity field label template for the LOWER bound (contains `{number}`).
     *
     * Still just "quantity", not "minimum quantity": for the overwhelmingly common line that states one
     * amount, this field IS the quantity, and naming it after the rarer range case would make every
     * ordinary row read oddly to a screen-reader user.
     */
    readonly ingredientQuantityLabel: string;
    /**
     * Ingredient-quantity field label template for the optional UPPER bound (contains `{number}`; U9/R42).
     *
     * A distinct accessible NAME, not a shared one — two spinbuttons with the same name inside one row are
     * indistinguishable to anyone navigating by name, which is the whole failure WCAG 3.3.2 addresses.
     */
    readonly ingredientQuantityHighLabel: string;
    /** Ingredient-unit field label template (contains `{number}`). */
    readonly ingredientUnitLabel: string;
    /**
     * Ingredient-PREPARATION field label template (contains `{number}`; plan U26).
     *
     * ⛔ "Preparation", never "notes". The wire's `notes` is a different field with a different producer (the
     * cookbook importer writes the source's whole clause into it) and NO editor writes it — see
     * `recipeIngredientNotesSchema`. Naming this control "notes" would invite exactly the merge U26 refused.
     */
    readonly ingredientPreparationLabel: string;
    /** Placeholder/hint shown inside the preparation field — the KTD-11b vocabulary, by example. */
    readonly ingredientPreparationPlaceholder: string;
    /**
     * Ingredient-SECTION field label template (contains `{number}`; plan U27).
     *
     * "Section" rather than "group": what a cook sees is a heading above a run of lines, and "group" reads
     * as a verb on a control that does not group anything by itself.
     */
    readonly ingredientGroupLabel: string;
    /** Placeholder/hint shown inside the section field — free text, by example, never a closed set. */
    readonly ingredientGroupPlaceholder: string;
    /**
     * Note shown beside a unit that names no defined amount — `handful`, `splash`, `to taste` (plan U25).
     *
     * ⛔ It is a DESCRIPTION, not an error. A cook's measure is a legitimate thing to write, and the line is
     * accepted unchanged; what the note says is that nothing can weigh it, which is why the line adds nothing
     * to the nutrition total.
     */
    readonly ingredientUnitSubjectiveNote: string;
    /**
     * Note shown beside a unit this vocabulary has never seen (plan U25).
     *
     * ⛔ ALSO not an error, and deliberately distinct from the note above. The whole point of the three-way
     * classification is that a deliberate `handful` must not read like a mistyped `blorp` — which is what a
     * colour-only mark (the mockup's) cannot express, and what a two-way recognised/unrecognised split
     * cannot either.
     */
    readonly ingredientUnitUnknownNote: string;
    /** Accessible label for an ingredient line's resolution-status badge (contains `{number}`). */
    readonly ingredientStatusLabel: string;
    /** Add-ingredient action label. */
    readonly addIngredient: string;
    /** Remove-ingredient action label template (contains `{number}`). */
    readonly removeIngredient: string;
    /** Empty-state copy shown when there are no ingredient lines yet. */
    readonly noIngredients: string;
    /** Per-row calorie figure template (contains `{calories}`; w3/e3, FR-007). Absent entirely when uncomputable. */
    readonly ingredientCaloriesTemplate: string;
    /**
     * The running per-serving nutrition total template (w3/e3, FR-007; contains `{calories}`, `{protein}`,
     * `{carbs}`, `{fat}`) — mirrors the wireframe's `Total nutrition (per serving): 420 cal | 18g P | 62g C |
     * 12g F` line verbatim.
     */
    readonly nutritionTotalTemplate: string;
    /** Honest affordance shown alongside the total when it is partial (FR-007 — some lines aren't counted yet). */
    readonly nutritionPartialNotice: string;
    /**
     * Disclosure shown alongside the running total when a line states a RANGE and the figure was computed
     * from its LOWER bound (R38). A whole sentence per bound — see `rangeDerivedNotice`.
     */
    readonly nutritionRangeDerivedLow: string;
    /** The same disclosure for a figure computed from the UPPER bound (R38). */
    readonly nutritionRangeDerivedHigh: string;

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
    /**
     * Resolution-status badge: the U11 verification gate contradicted this line (plan U14 / R15).
     *
     * ⛔ Distinct from every badge above. Those describe the FOOD LINK's lifecycle as food-service reports it;
     * this one is OUR own doubt about the match, and it is the only status a cook can act on by re-picking.
     */
    readonly statusNeedsReview: string;

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

    /** Localized copy for each `RecipeFormErrorCode` validation error (B20). */
    readonly errors: {
        readonly titleRequired: string;
        readonly ingredientsEmpty: string;
        readonly ingredientsUnresolved: string;
        readonly ingredientsQuantityInvalid: string;
        readonly stepsRequired: string;
        readonly servingsPositive: string;
        readonly timesNonNegative: string;
    };
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
        charCounterTemplate: '{count}/{max}',
        cuisineLabel: 'Cuisine',
        cuisineUnsetOption: 'No cuisine',
        difficultyLabel: 'Difficulty',
        difficultyEasy: 'Easy',
        difficultyMedium: 'Medium',
        difficultyHard: 'Hard',
        difficultyNotStated: 'Not stated',
        tagsLabel: 'Tags',
        tagsHint: 'Type and press Enter',
        removeChipLabel: 'Remove {value}',
        addChipLabel: 'Add {field}',
        dietaryFlagsLabel: 'Dietary flags',
        servingsLabel: 'Servings',
        prepTimeLabel: 'Prep time (minutes)',
        cookTimeLabel: 'Cook time (minutes)',
        totalTimeLabel: 'Total time',
        durationMinutes: '{minutes} min',

        ingredientsHeading: 'Ingredients',
        ingredientNameLabel: 'Ingredient {number} name',
        ingredientQuantityLabel: 'Ingredient {number} quantity',
        ingredientQuantityHighLabel: 'Ingredient {number} maximum quantity',
        ingredientUnitLabel: 'Ingredient {number} unit',
        ingredientPreparationLabel: 'Ingredient {number} preparation',
        ingredientPreparationPlaceholder: 'e.g. finely chopped, melted, at room temperature',
        ingredientGroupLabel: 'Ingredient {number} section',
        ingredientGroupPlaceholder: 'e.g. For the marinade',
        ingredientUnitSubjectiveNote: 'Cook\u2019s measure',
        ingredientUnitUnknownNote: 'Unrecognised unit',
        ingredientStatusLabel: 'Ingredient {number} status',
        addIngredient: 'Add ingredient',
        removeIngredient: 'Remove ingredient {number}',
        noIngredients: 'No ingredients yet. Add your first ingredient.',
        ingredientCaloriesTemplate: '{calories} cal',
        nutritionTotalTemplate: 'Total nutrition (per serving): {calories} cal | {protein}g P | {carbs}g C | {fat}g F',
        nutritionPartialNotice: 'Partial — some ingredients aren’t counted yet',
        nutritionRangeDerivedLow: 'Estimated from the lower amount of each stated range',
        nutritionRangeDerivedHigh: 'Estimated from the upper amount of each stated range',

        statusPending: 'Resolving…',
        statusUnresolved: 'Not resolved',
        statusResolved: 'Resolved',
        statusNotFound: 'No match found',
        statusFailed: 'Resolution failed',
        statusNeedsReview: 'Needs review',

        stepsHeading: 'Instructions',
        stepInstructionLabel: 'Step {number} instruction',
        stepTimerLabel: 'Step {number} timer (seconds)',
        addStep: 'Add step',
        removeStep: 'Remove step {number}',
        noSteps: 'No steps yet. Add your first step.',

        visibilityLabel: 'Private recipe',

        errors: {
            titleRequired: 'A title is required.',
            ingredientsEmpty: 'Add at least one ingredient.',
            // U9 split this sentence in two. It used to read "...a resolved item AND a quantity greater than
            // zero", which stopped being true when an absent quantity became legal (R40): a line may now
            // state no amount at all. Each code names the one field it is about.
            ingredientsUnresolved: 'Every ingredient needs an item picked from the list.',
            ingredientsQuantityInvalid:
                'Check the quantities: an amount must be greater than zero, and a maximum must be above it. Leave both blank if the recipe states no amount.',
            stepsRequired: 'Add at least one instruction step.',
            servingsPositive: 'Servings must be greater than zero.',
            timesNonNegative: 'Times cannot be negative.',
        },
    },
};
