/**
 * @module @commise/features-recipes/hooks — the headless-hook seam (CP-6/B4). Platform-agnostic React
 * hooks that encapsulate recipe-editing orchestration shared by the web and mobile apps. Exported at a
 * separate `./hooks` subpath (not folded into the root barrel) so a non-React consumer of the package's
 * pure models never pulls React hooks in.
 */

export { INGREDIENT_SEARCH_DEBOUNCE_MS } from './ingredientSearchDebounce.js';
export { toIngredientLine } from './lineCommit.js';
export { AUTHORED_MACRO_FIELDS, draftFromQuery, validateAuthoredFoodDraft } from './authoredFoodCreate.model.js';
export type {
    AuthoredFoodCreateState,
    AuthoredFoodDraft,
    AuthoredFoodFieldError,
    AuthoredFoodFieldErrors,
} from './authoredFoodCreate.model.js';
export { useDebouncedValue } from './useDebouncedValue.js';
export { useDeferredDiscoveryCriteria } from './useDeferredDiscoveryCriteria.js';
export type { DeferredDiscoveryCriteria } from './useDeferredDiscoveryCriteria.js';
export { toRecipeNutritionPages, useRecipeNutritionBatches } from './useRecipeNutritionBatches.js';
export { useLibraryEmpty } from './useLibraryEmpty.js';
export type { RecipeNutritionLookup } from './useRecipeNutritionBatches.js';
export { usePollIngredientStatus } from './usePollIngredientStatus.js';
export { useLineNutrition } from './useLineNutrition.js';
export { useLookupRetry } from './useLookupRetry.js';
export { useRecipeDraftPhotos } from './useRecipeDraftPhotos.js';
export type {
    DraftPhotoFlush,
    DraftPhotoPick,
    UseRecipeDraftPhotosOptions,
    UseRecipeDraftPhotosResult,
} from './useRecipeDraftPhotos.js';
export { useRecipePhotoUpload } from './useRecipePhotoUpload.js';
export type {
    RecipePhotoUploadFile,
    RecipePhotoUploadOutcome,
    UseRecipePhotoUploadResult,
} from './useRecipePhotoUpload.js';
export { useRecipePhotoUploadQueue } from './useRecipePhotoUploadQueue.js';
export type {
    RecipePhotoQueueFile,
    RecipePhotoQueueItem,
    RecipePhotoQueueStatus,
    RecipePhotoValidationMessages,
    UseRecipePhotoUploadQueueResult,
} from './useRecipePhotoUploadQueue.js';
export { useIngredientEntry } from './useIngredientEntry.js';
export type { IngredientEntry, UseIngredientEntryOptions } from './useIngredientEntry.js';
export type { EntryLine, PendingEntry } from './ingredientEntry.model.js';
export { useLineCommit } from './useLineCommit.js';
export type { LineCommit, LineCommitSurface, SettledLineCommit } from './useLineCommit.js';
export { useIngredientRowEditor } from './useIngredientRowEditor.js';
export type {
    IngredientRowEditor,
    RowCommitOrigin,
    RowDetailsController,
    RowDetailsTarget,
    SettledRowCommit,
    UseIngredientRowEditorOptions,
} from './useIngredientRowEditor.js';
export type {
    IngredientPick,
    LineCommandPort,
    LineCommitOutcome,
    LineCommitPort,
    LineCommitTarget,
} from './lineCommit.js';
export { useAuthoredFoodCreate } from './useAuthoredFoodCreate.js';
export type { AuthoredFoodCreateController, UseAuthoredFoodCreateOptions } from './useAuthoredFoodCreate.js';
export { useSourceLimit } from './useSourceLimit.js';
export type { SourceLimit } from './useSourceLimit.js';
export { useIngredientFilterSearch } from './useIngredientFilterSearch.js';
export type { UseIngredientFilterSearchResult } from './useIngredientFilterSearch.js';
export { useRecipeEditor } from './useRecipeEditor.js';
export type {
    EditorExit,
    EditorSeed,
    EditorState,
    EditorWriteAnswer,
    EditorWritePort,
    ReportedTrigger,
    ResumeNotice,
    UseRecipeEditorOptions,
    UseRecipeEditorResult,
} from './useRecipeEditor.js';
export { useBrowseRailsRefresh } from './useBrowseRailsRefresh.js';
export type { BrowseRailsRefresh } from './useBrowseRailsRefresh.js';
export { useRecentSearches } from './useRecentSearches.js';
export type { UseRecentSearchesResult } from './useRecentSearches.js';
export { useSaveCopy } from './useSaveCopy.js';
export type { SaveCopy, SaveCopyState } from './useSaveCopy.js';
export { useMemberToggle } from './useMemberToggle.js';
export { usePickerAnnouncement } from './usePickerAnnouncement.js';
export type { MemberToggleControl } from './useMemberToggle.js';
export type { PickerAnnouncement } from './usePickerAnnouncement.js';
export { useMemberRemoval } from './useMemberRemoval.js';
export type { MemberRemoval, RemovableMember } from './useMemberRemoval.js';
export { useCollectionVisibility } from './useCollectionVisibility.js';
export type { CollectionVisibilityControl } from './useCollectionVisibility.js';
export { useCollectionPull } from './useCollectionPull.js';
export type { CollectionPull, CollectionPullError } from './useCollectionPull.js';
export { useLastDefined } from './useLastDefined.js';
