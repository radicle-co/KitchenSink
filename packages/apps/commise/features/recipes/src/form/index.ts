/**
 * @module @commise/features-recipes/form — platform-neutral barrel for the recipe create/edit form
 * building block (T067). The component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`)
 * leaf at bundle time; the model, props, and message layers are platform-agnostic. The apps compose this
 * into their recipe create/edit page/screen, wiring validation, ingredient typeahead, and submission.
 */
export { RecipeForm } from './RecipeForm.js';
export { RecipeBasicsFields } from './RecipeBasicsFields.js';
export { RecipeIngredientsFields } from './RecipeIngredientsFields.js';
export { RecipeInstructionsFields } from './RecipeInstructionsFields.js';
export { RecipeReviewFields } from './RecipeReviewFields.js';
export type { RecipeReviewFieldsProps } from './RecipeReviewFields.js';
export { RecipeVisibilityField } from './RecipeVisibilityField.js';
export { ChipInput } from './ChipInput.js';
export type { ChipInputProps } from './ChipInput.js';

export {
    canAdvanceFromStep,
    computeTotalTime,
    defaultRecipeFormValues,
    pendingIngredientIds,
    setIngredientStatusById,
    stepErrorsFor,
    toCreateRecipeInput,
    toNutritionLine,
    toRecipeFormValues,
    toUpdateRecipeInput,
    validateRecipeForm,
} from './model.js';
export type {
    RecipeFormErrors,
    RecipeFormIngredient,
    RecipeFormPhoto,
    RecipeFormStep,
    RecipeFormValues,
    RecipeWizardStep,
} from './model.js';

export {
    addChip,
    addStep,
    appendResolvedIngredient,
    blankStep,
    difficultyOptions,
    mealTypeOptions,
    parseCommaList,
    parseNumericInput,
    removeChipAt,
    removeIngredientAt,
    removeStepAt,
    resolutionStatusLabel,
    reviewIngredientLabel,
    reviewRows,
    setDifficulty,
    setMealType,
    updateIngredientAt,
    updateStepAt,
} from './props.js';
export type {
    DifficultyOption,
    MealTypeOption,
    RecipeFormMode,
    RecipeFormProps,
    RecipeFormSectionProps,
    RecipeIngredientsFieldsProps,
    RecipeReviewRow,
    ResolvedRecipeFormIngredient,
} from './props.js';

export { recipeFormMessages } from './messages.js';
export type { RecipeFormMessages } from './messages.js';
