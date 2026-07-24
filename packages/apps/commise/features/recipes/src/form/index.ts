/**
 * @module @commise/features-recipes/form — platform-neutral barrel for the recipe create/edit form
 * building block (T067). The component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`)
 * leaf at bundle time; the model, props, and message layers are platform-agnostic. The apps compose this
 * into their recipe create/edit page/screen, wiring validation, ingredient typeahead, and submission.
 */
export { RecipeForm } from './RecipeForm.js';

export {
    applyDraftToRecipeDetail,
    computeTotalTime,
    defaultRecipeFormValues,
    pendingIngredientIds,
    setIngredientStatusById,
    toCreateRecipeInput,
    toRecipeFormValues,
    toUpdateRecipeInput,
    validateRecipeForm,
} from './model.js';
export type { RecipeFormErrors, RecipeFormIngredient, RecipeFormStep, RecipeFormValues } from './model.js';

export {
    addIngredient,
    addStep,
    blankIngredient,
    blankStep,
    difficultyOptions,
    parseCommaList,
    parseNumericInput,
    removeIngredientAt,
    removeStepAt,
    resolutionStatusLabel,
    setDifficulty,
    updateIngredientAt,
    updateStepAt,
} from './props.js';
export type { DifficultyOption, RecipeFormMode, RecipeFormProps } from './props.js';

export { recipeFormMessages } from './messages.js';
export type { RecipeFormMessages } from './messages.js';
