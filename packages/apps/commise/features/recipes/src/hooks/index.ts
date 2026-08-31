/**
 * @module @commise/features-recipes/hooks — the headless-hook seam (CP-6/B4). Platform-agnostic React
 * hooks that encapsulate recipe-editing orchestration shared by the web and mobile apps. Exported at a
 * separate `./hooks` subpath (not folded into the root barrel) so a non-React consumer of the package's
 * pure models never pulls React hooks in.
 */

export {
    INGREDIENT_SEARCH_DEBOUNCE_MS,
    deriveViewState,
    isTerminalStatus,
    isUnresolvedStatus,
    nextMatchAction,
    suggestionKey,
    suggestionName,
    toIngredientLine,
} from './ingredientResolver.model.js';
export type {
    DeriveViewStateInput,
    IngredientPickerHandle,
    IngredientResolverViewState,
    MutationView,
} from './ingredientResolver.model.js';
export { AUTHORED_MACRO_FIELDS, draftFromQuery, validateAuthoredFoodDraft } from './authoredFoodCreate.model.js';
export type {
    AuthoredFoodCreateState,
    AuthoredFoodDraft,
    AuthoredFoodFieldError,
    AuthoredFoodFieldErrors,
} from './authoredFoodCreate.model.js';
export { useDebouncedValue } from './useDebouncedValue.js';
export { toRecipeNutritionPages, useRecipeNutritionBatches } from './useRecipeNutritionBatches.js';
export type { RecipeNutritionLookup } from './useRecipeNutritionBatches.js';
export { usePollIngredientStatus } from './usePollIngredientStatus.js';
export { AUTO_SAVE_INTERVAL_MS, useRecipeAutoSave } from './useRecipeAutoSave.js';
export type { UseRecipeAutoSaveOptions } from './useRecipeAutoSave.js';
export { useRecipeDraftPhotos } from './useRecipeDraftPhotos.js';
export type {
    DraftPhotoFlush,
    DraftPhotoPick,
    UseRecipeDraftPhotosOptions,
    UseRecipeDraftPhotosResult,
} from './useRecipeDraftPhotos.js';
export { useRecipePhotoUpload } from './useRecipePhotoUpload.js';
export type { RecipePhotoUploadFile, UseRecipePhotoUploadResult } from './useRecipePhotoUpload.js';
export { useRecipePhotoUploadQueue } from './useRecipePhotoUploadQueue.js';
export type {
    RecipePhotoQueueFile,
    RecipePhotoQueueItem,
    RecipePhotoQueueStatus,
    RecipePhotoValidationMessages,
    UseRecipePhotoUploadQueueResult,
} from './useRecipePhotoUploadQueue.js';
export { useIngredientCorrection } from './useIngredientCorrection.js';
export type { IngredientCorrectionController } from './useIngredientCorrection.js';
export { useIngredientResolver } from './useIngredientResolver.js';
export type { UseIngredientResolverResult } from './useIngredientResolver.js';
export { useIngredientFilterSearch } from './useIngredientFilterSearch.js';
export type { UseIngredientFilterSearchResult } from './useIngredientFilterSearch.js';
export { useRecipeEditor } from './useRecipeEditor.js';
export type {
    EditorState,
    RecipeEditorQueryState,
    UseRecipeEditorOptions,
    UseRecipeEditorResult,
} from './useRecipeEditor.js';
export { useBrowseRails } from './useBrowseRails.js';
export type { BrowseRailQuery, UseBrowseRailsResult } from './useBrowseRails.js';
export { useRecentSearches } from './useRecentSearches.js';
export type { UseRecentSearchesResult } from './useRecentSearches.js';
