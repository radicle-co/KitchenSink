/**
 * @module @commise/features-recipes/wizard — platform-neutral barrel for the 4-step recipe-edit wizard
 * shell (w3/e1,e2, P8). The `Wizard` compound-component specifier resolves to its web (`Wizard.tsx`) or
 * native (`Wizard.native.tsx`) leaf at bundle time; the model, discard-guard hook, and messages layers are
 * platform-agnostic. The apps compose this into their recipe create/edit container/screen alongside the
 * shared `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/`RecipeVisibilityField`
 * leaves (`../form/index.js`) as each step's body.
 */
export { Wizard } from './Wizard.js';
export type { WizardProps } from './Wizard.js';

export { deriveRailStepState, recipeFormValuesEqual, WIZARD_STEPS, WIZARD_TOTAL_STEPS } from './model.js';
export type { WizardRailStepState } from './model.js';

export { useDiscardGuard } from './useDiscardGuard.js';
export type { UseDiscardGuardOptions } from './useDiscardGuard.js';

export { wizardMessages } from './messages.js';
export type { WizardMessages } from './messages.js';
