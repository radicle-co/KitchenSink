/**
 * @module @commise/features-recipes — recipe feature slice: Home-widget descriptor
 * + skeleton building-block components. NO page exports — the apps compose pages.
 * Platform widget entrypoints ship via the `./widget/web` and `./widget/mobile`
 * package exports; the building blocks re-exported here resolve per platform.
 */

export {
    RECIPE_HOME_WIDGET_CAPABILITY,
    RECIPE_HOME_WIDGET_DEFAULT_WEIGHT,
    RECIPE_HOME_WIDGET_ID,
    recipeHomeWidgetDescriptor,
} from './descriptor.js';
export { RecipeCardGridSkeleton } from './card/RecipeCardGridSkeleton.js';
export type { RecipeCardGridSkeletonProps } from './card/RecipeCardGridSkeleton.js';
// The feature's own copy dictionary. Exported so a HOST that paints a recipe surface outside the feature's
// own components — the web route-level `loading.tsx` grid skeleton — says the SAME "Loading recipes" the
// in-page skeleton does, instead of minting a second string for the same wait.
export { recipeMessages } from './messages.js';
export type { IngredientSearchMessages } from './messages.js';
export type { IngredientCreateFoodMessages } from './messages.js';
export type { RecipeMessages } from './messages.js';

export { RecipeCard } from './card/RecipeCard.js';
export {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatRatingCount,
    formatRelativeTime,
    toRecipeCardModel,
    toStarFills,
} from './card/model.js';
export type { RecipeCardProps } from './card/RecipeCard.js';
export type { DifficultyTone, RatingCountLabels, RecipeCardModel } from './card/model.js';
export { recipeCorrectionMessages } from './correction/messages.js';
export { toCorrectionNoticeModel, toCorrectionViewState } from './correction/model.js';
export type { RecipeCorrectionMessages } from './correction/messages.js';
export type {
    CorrectionNoOutcome,
    CorrectionNoticeModel,
    CorrectionNoticeTone,
    CorrectionScope,
    CorrectionViewState,
} from './correction/model.js';
export { RecipeCalorieChip } from './nutrition/RecipeCalorieChip.js';
export { RecipeCalorieSkeleton } from './nutrition/RecipeCalorieSkeleton.js';
export { RecipeNutritionBoundary } from './nutrition/RecipeNutritionBoundary.js';
export { RecipeNutritionSlot } from './nutrition/RecipeNutritionSlot.js';
export { recipeNutritionMessages } from './nutrition/messages.js';
export { NUTRITION_FOOD_UNAVAILABLE, toCalorieChipModel, unaccountedReasonText } from './nutrition/model.js';
export type { RecipeCalorieChipProps } from './nutrition/RecipeCalorieChip.js';
export type { RecipeCalorieSkeletonProps } from './nutrition/RecipeCalorieSkeleton.js';
export type { RecipeNutritionBoundaryProps } from './nutrition/RecipeNutritionBoundary.js';
export type { RecipeNutritionSlotProps } from './nutrition/RecipeNutritionSlot.js';
export type { RecipeNutritionMessages } from './nutrition/messages.js';
export type {
    RecipeCalorieChipModel,
    RecipeCaloriePending,
    RecipeCalorieReading,
    RecipeCalorieState,
    RecipeCalorieUnaccounted,
    RecipeCalorieUnaccountedReason,
    RecipeNutritionViewState,
    RenderRecipeNutrition,
} from './nutrition/model.js';
export { RecentRecipeGrid } from './components/RecentRecipeGrid.js';
export { RecentRecipeItem } from './components/RecentRecipeItem.js';
export { RecipeWidgetCard } from './components/RecipeWidgetCard.js';
export { RecipeWidgetEmptyState } from './components/RecipeWidgetEmptyState.js';
export { RecipeWidgetLoadingCard } from './components/RecipeWidgetLoadingCard.js';
export { RecipeWidgetSkeleton } from './components/RecipeWidgetSkeleton.js';
export { MAX_RECENT_RECIPES, toRecipeSummary } from './components/props.js';
export type {
    RecentRecipeGridProps,
    RecentRecipeItemProps,
    RecipeSummary,
    RecipeWidgetCardProps,
    RecipeWidgetEmptyStateProps,
    RecipeWidgetSkeletonProps,
} from './components/props.js';
export { RecipeList } from './list/RecipeList.js';
export { RecipeListCard } from './list/RecipeListCard.js';
export { RecipeSourceTabs } from './list/RecipeSourceTabs.js';
export {
    QUICK_TIME_FACET,
    QUICK_TIME_THRESHOLD_MINUTES,
    RECIPE_SOURCE_TABS,
    fillTemplate,
    filterChipLabel,
    formatDurationMinutes,
    formatRecipeCount,
    isListNarrowed,
    isQuickRecipe,
    matchesListFacet,
    sourceTabLabel,
    toRecipeListItem,
} from './list/model.js';
export type { RecipeSourceTabsProps } from './list/RecipeSourceTabs.js';
export type {
    RecipeCountLabels,
    RecipeFacetSource,
    RecipeListCardProps,
    RecipeListItem,
    RecipeListStatus,
    RecipeListTab,
    RecipeListTabControl,
    RecipeListViewProps,
} from './list/model.js';
export { RecipeDetailView } from './detail/RecipeDetailView.js';
export { RecipeSourceLine } from './detail/RecipeSourceLine.js';
export { ServingScaleControl } from './detail/ServingScaleControl.js';
export { formatQuantity } from './detail/model.js';
export { resetServingScale } from './detail/servingScale.js';
export { useCookingProgress } from './detail/useCookingProgress.js';
export { useServingScale } from './detail/useServingScale.js';
export type {
    RecipeDetailBodyProps,
    RecipeDetailViewProps,
    RecipeSourceLineNativeProps,
    RecipeSourceLineProps,
    ServingScaleControlProps,
} from './detail/model.js';
export type { CookingProgressBinding } from './detail/useCookingProgress.js';
export type { ServingScaleBinding } from './detail/useServingScale.js';
export { RecipeRatingDisplay } from './rating/RecipeRatingDisplay.js';
export { RecipeRatingInput } from './rating/RecipeRatingInput.js';
export { recipeRatingMessages } from './rating/messages.js';
export { STAR_VALUES, formatStarOptionLabel, ratingModeFor } from './rating/model.js';
export type { RecipeRatingMessages } from './rating/messages.js';
export type {
    RecipeRatingAggregate,
    RecipeRatingDisplayProps,
    RecipeRatingError,
    RecipeRatingInputProps,
    RecipeRatingMode,
    StarOptionLabels,
} from './rating/model.js';
export { ChipInput } from './form/ChipInput.js';
export { RecipeBasicsFields } from './form/RecipeBasicsFields.js';
export { RecipeForm } from './form/RecipeForm.js';
export { RecipeIngredientsFields } from './form/RecipeIngredientsFields.js';
export { RecipeInstructionsFields } from './form/RecipeInstructionsFields.js';
export { RecipeReviewFields } from './form/RecipeReviewFields.js';
export { RecipeVisibilityField } from './form/RecipeVisibilityField.js';
export { pendingIngredientIds, setIngredientStatusById } from './form/ingredientStatus.js';
export { recipeFormMessages } from './form/messages.js';
export { toNutritionLine } from './form/nutrition.js';
export {
    addChip,
    applyDraftAction,
    blankStep,
    difficultyOptions,
    mealTypeOptions,
    parseCommaList,
    parseNumericInput,
    removeChipAt,
    resolutionStatusLabel,
    reviewIngredientLabel,
    reviewRows,
} from './form/props.js';
export { canAdvanceFromStep, stepErrorsFor } from './form/steps.js';
export { computeTotalTime } from './form/totalTime.js';
export { validateRecipeForm } from './form/validate.js';
export { defaultRecipeFormValues } from './form/values.js';
export { toCreateRecipeInput, toRecipeFormValues, toUpdateRecipeInput } from './form/wire.js';
export type { ChipInputProps } from './form/ChipInput.js';
export type { RecipeReviewFieldsProps } from './form/RecipeReviewFields.js';
export type { RecipeFormMessages } from './form/messages.js';
export type {
    DifficultyOption,
    DraftAction,
    DraftListField,
    MealTypeOption,
    RecipeFormMode,
    RecipeFormProps,
    RecipeFormSectionProps,
    RecipeIngredientsFieldsProps,
    RecipeReviewRow,
    ResolvedRecipeFormIngredient,
} from './form/props.js';
export type { RecipeWizardStep } from './form/steps.js';
export type { RecipeFormErrors } from './form/validate.js';
export type { RecipeFormIngredient, RecipeFormPhoto, RecipeFormStep, RecipeFormValues } from './form/values.js';
export { MoreActionsMenu } from './actions/MoreActionsMenu.js';
export { RecipeCloneAction } from './actions/RecipeCloneAction.js';
export { RecipeDeleteDialog } from './actions/RecipeDeleteDialog.js';
export { RecipeVisibilityToggle } from './actions/RecipeVisibilityToggle.js';
export { recipeActionMessages } from './actions/messages.js';
export type {
    RecipeActionMessages,
    RecipeCloneActionMessages,
    RecipeDeleteDialogMessages,
    RecipeMoreMenuMessages,
    RecipeVisibilityToggleMessages,
} from './actions/messages.js';
export type {
    MoreActionsMenuProps,
    RecipeCloneActionProps,
    RecipeDeleteDialogProps,
    RecipeVisibilityToggleProps,
} from './actions/model.js';
export { RecipeConflictView } from './versions/RecipeConflictView.js';
export { RecipeVersionList } from './versions/RecipeVersionList.js';
export { VersionCompareView } from './versions/VersionCompareView.js';
export { VersionPreviewModal } from './versions/VersionPreviewModal.js';
export { buildCompareFieldRows, compareViewState, formatCollectionTally } from './versions/compare.js';
export type { CompareFieldRow, VersionCompareState, VersionCompareViewProps } from './versions/compare.js';
export { computeConflictDiff } from './versions/conflictDiff.js';
export type { ConflictDiff, ConflictFieldKind, ConflictFieldRow, ConflictMarker } from './versions/conflictDiff.js';
export {
    countMergeSelections,
    formatMergeSummary,
    formatServerBanner,
    isConflictBaseStale,
} from './versions/conflictView.js';
export type { MergeSelectionCounts, RecipeConflictViewProps } from './versions/conflictView.js';
export { diffSnapshots } from './versions/diff.js';
export type { DiffTally, SnapshotDiff, SnapshotFieldKey } from './versions/diff.js';
export {
    conflictFieldKindLabel,
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    snapshotFieldLabel,
} from './versions/diffLabels.js';
export { sortVersionsDescending } from './versions/history.js';
export type { RecipeVersionListProps, RecipeVersionRestoreError } from './versions/history.js';
export {
    applyServerSnapshotToRecipeDetail,
    composeConflictMerge,
    composeMergedRecipe,
    draftToSnapshot,
} from './versions/merge.js';
export type { MergeSide, RecipeMergeSelections } from './versions/merge.js';
export { recipeVersionMessages } from './versions/messages.js';
export type {
    RecipeConflictMessages,
    RecipeVersionCompareMessages,
    RecipeVersionListMessages,
    RecipeVersionMessages,
    RecipeVersionPreviewMessages,
} from './versions/messages.js';
export {
    changedFromCurrentCounts,
    formatChangedFromCurrent,
    resolveVersionPreview,
    toVersionPreviewIngredientLines,
} from './versions/preview.js';
export type {
    VersionPreviewIngredientLine,
    VersionPreviewModalProps,
    VersionPreviewSource,
    VersionPreviewState,
} from './versions/preview.js';
export { formatRelativeTimeAgo, formatVersionTimestamp } from './versions/timeFormat.js';
export { CloneInfoPanel } from './collections/CloneInfoPanel.js';
export { CollectionActions } from './collections/CollectionActions.js';
export { CollectionDetail } from './collections/CollectionDetail.js';
export { CollectionForm } from './collections/CollectionForm.js';
export { CollectionHeader } from './collections/CollectionHeader.js';
export { CollectionList } from './collections/CollectionList.js';
export { CollectionMemberRow } from './collections/CollectionMemberRow.js';
export { CollectionRecipePicker } from './collections/CollectionRecipePicker.js';
export { PullUpdatesDialog } from './collections/PullUpdatesDialog.js';
export { collectionMessages } from './collections/messages.js';
export { formatCollectionDate } from './collections/model.js';
export type { CloneInfoPanelMessages, CollectionMessages, PullUpdatesDialogMessages } from './collections/messages.js';
export type {
    CloneInfoPanelProps,
    CollectionActionsProps,
    CollectionDetailError,
    CollectionDetailViewProps,
    CollectionFormMode,
    CollectionFormProps,
    CollectionHeaderViewProps,
    CollectionListLoadMore,
    CollectionListStatus,
    CollectionListViewProps,
    CollectionMemberRecipe,
    CollectionMemberRowProps,
    CollectionRecipePickerProps,
    CollectionWithRecipes,
    PullUpdatesDialogProps,
    RecipePickerStatus,
} from './collections/model.js';
export { RecipeBrowseRails } from './discovery/RecipeBrowseRails.js';
export { RecipeDiscoveryCard } from './discovery/RecipeDiscoveryCard.js';
export { RecipeDiscoveryList } from './discovery/RecipeDiscoveryList.js';
export { discoveryMessages } from './discovery/messages.js';
export {
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    DISCOVERY_SORTS,
    RECIPE_BROWSE_RAILS,
    RECIPE_BROWSE_RAIL_PAGE_SIZE,
} from './discovery/model.js';
export {
    MAX_RECENT_SEARCHES,
    RECENT_SEARCHES_STORAGE_KEY,
    addRecentSearch,
    mergeRecentSearches,
    parseRecentSearches,
    serializeRecentSearches,
} from './discovery/recentSearches.js';
export type { DiscoveryMessages } from './discovery/messages.js';
export type {
    RecipeBrowseCuisineShortcut,
    RecipeBrowseRailDefinition,
    RecipeBrowseRailId,
    RecipeBrowseRailView,
    RecipeBrowseRailsProps,
    RecipeDiscoveryCardProps,
    RecipeDiscoveryListProps,
    RecipeDiscoverySortControl,
    RecipeDiscoveryStatus,
    RecipeRecentSearchesControl,
} from './discovery/model.js';
export type { RecentSearchStore } from './discovery/recentSearches.js';
export { RecipePhotoManager } from './photos/RecipePhotoManager.js';
export { photoMessages } from './photos/messages.js';
export { MAX_RECIPE_PHOTOS, isAtPhotoCap, visibleQueueItems } from './photos/model.js';
export type { PhotoMessages } from './photos/messages.js';
export type { RecipePhotoManagerProps } from './photos/model.js';
export { RecipeFilterBar } from './filters/RecipeFilterBar.js';
export { filterMessages } from './filters/messages.js';
export {
    EMPTY_RECIPE_FILTERS,
    TIME_BUCKETS_MINUTES,
    TOTAL_TIME_BUCKETS_MINUTES,
    applyFilterAction,
    buildFacetChips,
    countActiveFilters,
    deriveIngredientFilterSearchViewState,
    filtersFromQueryString,
    filtersToQueryString,
    filtersToSearchParams,
    formatFacetChipName,
    hasActiveFilters,
} from './filters/model.js';
export type { FilterMessages } from './filters/messages.js';
export type {
    DeriveIngredientFilterSearchViewStateInput,
    FacetDimension,
    FilterAction,
    IngredientFilterSearchViewState,
    RecipeFacetChip,
    RecipeFacets,
    RecipeFilterBarProps,
    RecipeFilterState,
    RecipeIngredientFilter,
    RecipeIngredientSearchState,
    TimeBoundField,
} from './filters/model.js';
export { Wizard } from './wizard/Wizard.js';
export { wizardMessages } from './wizard/messages.js';
export { WIZARD_STEPS, WIZARD_TOTAL_STEPS, deriveRailStepState, recipeFormValuesEqual } from './wizard/model.js';
export { useDiscardGuard } from './wizard/useDiscardGuard.js';
export type { WizardProps } from './wizard/Wizard.js';
export type { WizardMessages } from './wizard/messages.js';
export type { WizardRailStepState } from './wizard/model.js';
export type { UseDiscardGuardOptions } from './wizard/useDiscardGuard.js';
export { ParseJobReview } from './parse/ParseJobReview.js';
export { ParsePasteForm } from './parse/ParsePasteForm.js';
export { recipeParseMessages } from './parse/messages.js';
export {
    PARSE_JOB_STALL_BOUND_MS,
    toParseJobProgress,
    toParseJobViewState,
    toParseLineModel,
    toParseSubmissionModel,
} from './parse/model.js';
export type { ParseLineCountLabels, RecipeParseMessages } from './parse/messages.js';
export type {
    ParseJobProgress,
    ParseJobViewState,
    ParseJobViewStateInput,
    ParseLineModel,
    ParseLineTone,
    ParseSubmissionModel,
} from './parse/model.js';
export type {
    ParseJobReviewProps,
    ParseLineCorrectionRenderer,
    ParseLineEditControl,
    ParseLineRowProps,
    ParsePasteFormProps,
    ParseRetryControl,
} from './parse/props.js';
