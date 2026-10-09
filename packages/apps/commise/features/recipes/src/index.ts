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
    LIST_VIEW_MODES,
    cardVariantOf,
    defaultViewModeOf,
    isListViewMode,
    type CardSurface,
    type CardVariant,
    type ListViewMode,
} from './card/cardVariant.js';
export { HOME_COLUMNS, libraryGridColumnsOf } from './card/cardGridLayout.js';
export {
    STAR_COUNT,
    formatAverageRating,
    formatRatingCount,
    formatRelativeTime,
    toRecipeCardModel,
    toStarFills,
} from './card/model.js';
export type { RecipeCardProps } from './card/recipeCardContext.js';
export type { RatingCountLabels, RecipeCardModel } from './card/model.js';
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
export { RecipeWidgetCard } from './components/RecipeWidgetCard.js';
export { RecipeWidgetEmptyState } from './components/RecipeWidgetEmptyState.js';
export { RecipeWidgetLoadingCard } from './components/RecipeWidgetLoadingCard.js';
export { RecipeWidgetLoadError } from './components/RecipeWidgetLoadError.js';
export { MAX_RECENT_RECIPES, toRecipeSummary } from './components/props.js';
export type {
    RecentRecipeGridProps,
    RecipeSummary,
    RecipeWidgetCardProps,
    RecipeWidgetEmptyStateProps,
    RecipeWidgetFirstRun,
    RecipeWidgetLoadErrorProps,
    RecipeWidgetLoadingCardProps,
    RecipeWidgetSeeAll,
} from './components/props.js';
export { RecipeCreateButton } from './list/RecipeCreateButton.js';
export type { RecipeCreateButtonAppearance, RecipeCreateButtonProps } from './list/createButtonProps.js';
export { RecipeListFrame } from './list/RecipeListFrame.js';
export { RecipeListLoadError } from './list/RecipeListLoadError.js';
export { RecipeListLoading } from './list/RecipeListLoading.js';
export { RecipeListResults } from './list/RecipeListResults.js';
export {
    LIBRARY_SORTS,
    availableFacetsOf,
    libraryFacetsOf,
    libraryStateOf,
    narrowLibrary,
    sortLabelOf,
} from './list/library.js';
export type { LibraryFacet, LibraryState } from './list/libraryTypes.js';
export { VIEW_MODE_KEY, viewModeCookieFor, viewModeFrom, viewModeOf } from './list/viewModePreference.js';
export { useMainContainerClass } from './layout/useMainContainerClass.js';
export { RecipeSourceTabs } from './list/RecipeSourceTabs.js';
export {
    QUICK_TIME_FACET,
    QUICK_TIME_THRESHOLD_MINUTES,
    RECIPE_SOURCE_TABS,
    RECIPES_SEGMENTS,
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
    RecipeListItem,
    RecipesSegment,
    RecipesSegmentControl,
    RecipeCreateDestinations,
    RecipeListFrameProps,
    RecipeListLoadErrorProps,
    RecipeListResultsProps,
    RecipeListTab,
    RecipeListTabControl,
} from './list/model.js';
export { RecipeDetailView } from './detail/RecipeDetailView.js';
export { RecipeSourceLine } from './detail/RecipeSourceLine.js';
export { ServingScaleControl } from './detail/ServingScaleControl.js';
export { formatQuantity, isUnreachableRecovery } from './detail/model.js';
export { resetServingScale } from './detail/servingScale.js';
export { CookMarksProvider } from './detail/CookMarksProvider.js';
export { clearStoredCookMarks } from './detail/cookMarksBackend.js';
export { detailMenuOf } from './detail/detailMenu.js';
export { useCookMarks } from './detail/useCookMarks.js';
export { useServingScale } from './detail/useServingScale.js';
export type {
    RecipeDetailBodyProps,
    RecipeDetailViewProps,
    RecipeSourceLineNativeProps,
    RecipeSourceLineProps,
    ServingScaleControlProps,
} from './detail/model.js';
export type { CookMarksProviderProps } from './detail/CookMarksProvider.js';
export type { DetailMenu, DetailMenuInput, DetailMenuItem } from './detail/detailMenu.js';
export type { DetailSection } from './detail/model.js';
export type { CookMarksBinding } from './detail/useCookMarks.js';
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
export { RecipeIngredientsFields } from './form/RecipeIngredientsFields.js';
export { IngredientsNutritionFoot, type IngredientsNutritionFootProps } from './form/IngredientsNutritionFoot.js';
export { RecipeInstructionsFields } from './form/RecipeInstructionsFields.js';
export { RecipeVisibilityField } from './form/RecipeVisibilityField.js';
export {
    pendingIngredientIds,
    settleIngredientLine,
    settleIngredientLines,
    type ObservedIngredientStatus,
    type SettledAnswer,
} from './form/ingredientStatus.js';
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
} from './form/props.js';
export { computeTotalTime } from './form/totalTime.js';
export { validateRecipeForm } from './form/validate.js';
export { defaultRecipeFormValues } from './form/values.js';
export { type IngredientLineKey } from './form/lineKey.js';
export { mintLineKey } from './form/mintLineKey.js';
export { toCreateRecipeInput, toRecipeFormValues, toUpdateRecipeInput } from './form/wire.js';
export type { ChipInputProps } from './form/ChipInput.js';
export type { RecipeFormMessages } from './form/messages.js';
export type { DraftAction, DraftListField, ResolvedRecipeFormIngredient } from './form/draftAction.js';
export type {
    DifficultyOption,
    MealTypeOption,
    RecipeFormMode,
    RecipeFormSectionProps,
    RecipeIngredientsFieldsProps,
} from './form/props.js';
export type { RecipeFormErrors } from './form/validate.js';
export type { RecipeFormIngredient, RecipeFormPhoto, RecipeFormStep, RecipeFormValues } from './form/values.js';
export { MoreActionsMenu } from './actions/MoreActionsMenu.js';
export { RecipeDeleteDialog } from './actions/RecipeDeleteDialog.js';
export { RecipeVisibilityToggle } from './actions/RecipeVisibilityToggle.js';
export { recipeActionMessages } from './actions/messages.js';
export type {
    RecipeActionMessages,
    RecipeDeleteDialogMessages,
    RecipeMoreMenuMessages,
    RecipeVisibilityToggleMessages,
} from './actions/messages.js';
export type { MoreActionsMenuProps, RecipeDeleteDialogProps, RecipeVisibilityToggleProps } from './actions/model.js';
export { RecipeConflictView } from './versions/RecipeConflictView.js';
export { RecipeVersionList } from './versions/RecipeVersionList.js';
export { VersionCompareView } from './versions/VersionCompareView.js';
export { VersionPreviewModal } from './versions/VersionPreviewModal.js';
export { compareRowsOf, compareWithCurrent } from './versions/compare.js';
export type { CompareRow, VersionCompareViewProps } from './versions/compare.js';
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
export { classifyRestoreError, sortVersionsDescending } from './versions/history.js';
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
export { CollectionDeleteDialog } from './collections/CollectionDeleteDialog.js';
export { CollectionHeader } from './collections/CollectionHeader.js';
export { CollectionListFrame } from './collections/CollectionListFrame.js';
export { CollectionListLoadError } from './collections/CollectionListLoadError.js';
export { CollectionListLoading } from './collections/CollectionListLoading.js';
export { CollectionListResults } from './collections/CollectionListResults.js';
export { CollectionMemberRow } from './collections/CollectionMemberRow.js';
export { CollectionMembers } from './collections/CollectionMembers.js';
export { CollectionPickerRow } from './collections/CollectionPickerRow.js';
export { CollectionRecipePicker } from './collections/CollectionRecipePicker.js';
export { CollectionRecipePickerCandidates } from './collections/CollectionRecipePickerCandidates.js';
export { CollectionRecipePickerLoadError } from './collections/CollectionRecipePickerLoadError.js';
export { CollectionRecipePickerLoading } from './collections/CollectionRecipePickerLoading.js';
export { CollectionSheet } from './collections/CollectionSheet.js';
export { CollectionUpsellSheet } from './collections/CollectionUpsellSheet.js';
export type {
    CollectionCreateSheetProps,
    CollectionRenameSheetProps,
    CollectionSheetProps,
} from './collections/sheetModel.js';
export { COLLECTION_DESCRIPTION_MAX_LENGTH, COLLECTION_NAME_MAX_LENGTH } from './collections/limits.js';
export { PullUpdatesDialog } from './collections/PullUpdatesDialog.js';
export { collectionMessages } from './collections/messages.js';
export { COLLECTION_SEARCH_FROM, formatCollectionDate, narrowCollections } from './collections/model.js';
export { doneSummaryOf, narrowByTitle } from './collections/pickerModel.js';
export { canUndoVisibilityChange, visibilityChangeNeedsPremium } from './collections/visibilityUndo.js';
export { MEMBER_WINDOW_SIZE } from './collections/detailModel.js';
export type { CollectionMessages, PullUpdatesDialogMessages } from './collections/messages.js';
export type {
    CollectionActionsPlacement,
    CollectionDeleteDialogProps,
    CollectionHeaderProps,
    CollectionMemberRowProps,
    CollectionMembersProps,
    CollectionPickerRowProps,
    CollectionRecipePickerCandidatesProps,
    CollectionRecipePickerProps,
    CollectionUpsellSheetProps,
} from './collections/detailModel.js';
export type { PickerSummary } from './collections/pickerModel.js';
export type {
    CollectionListFrameProps,
    CollectionListLoadErrorProps,
    CollectionListLoadMore,
    CollectionListResultsProps,
    CollectionMemberRecipe,
    CollectionRecipePickerLoadErrorProps,
    CollectionWithRecipes,
    PullUpdatesDialogProps,
} from './collections/model.js';
export { RecipeBrowseRailLoadError } from './discovery/RecipeBrowseRailLoadError.js';
export { RecipeBrowseRailLoading } from './discovery/RecipeBrowseRailLoading.js';
export { RecipeBrowseRailResults } from './discovery/RecipeBrowseRailResults.js';
export { RecipeBrowseRails } from './discovery/RecipeBrowseRails.js';
export { RecipeDiscoveryCard } from './discovery/RecipeDiscoveryCard.js';
export { RecipeDiscoveryFrame } from './discovery/RecipeDiscoveryFrame.js';
export { RecipeDiscoveryLoadError } from './discovery/RecipeDiscoveryLoadError.js';
export { RecipeDiscoveryLoading } from './discovery/RecipeDiscoveryLoading.js';
export { RecipeDiscoveryResults } from './discovery/RecipeDiscoveryResults.js';
export { DiscoveryFooter } from './discovery/DiscoveryFooter.js';
export { DiscoverySortMenu } from './discovery/DiscoverySortMenu.js';
export { noResultKindOf, showsCuisineShortcuts, tryTheseTagsOf } from './discovery/noResults.js';
export type { NoResultKind } from './discovery/noResults.js';
export { discoveryMessages } from './discovery/messages.js';
export {
    DISCOVER_SEARCH_ID,
    DISCOVER_TITLE_ID,
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    DISCOVERY_SORTS,
    RECIPE_BROWSE_RAILS,
    RECIPE_BROWSE_RAIL_PAGE_SIZE,
    browseRailSearchParams,
    discoverySearchParams,
    discoverySortLabel,
    formatDiscoveryResultsSummary,
    isDiscoveryBrowsing,
    isDiscoverySearching,
    recipeIdPagesOf,
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
    RecipeBrowseRailLoadErrorProps,
    RecipeBrowseRailResultsProps,
    RecipeBrowseRailView,
    RecipeBrowseRailsProps,
    DiscoveryFilterSlots,
    DiscoveryNoResultControls,
    RecipeDiscoveryCardProps,
    RecipeDiscoveryCriteria,
    RecipeDiscoveryFrameProps,
    RecipeDiscoveryLoadErrorProps,
    RecipeDiscoveryResultsProps,
    RecipeDiscoveryResultsSummary,
    RecipeDiscoverySortControl,
    RecipeRecentSearchesControl,
} from './discovery/model.js';
export type { RecentSearchStore } from './discovery/recentSearches.js';
export { RecipePhotoManager } from './photos/RecipePhotoManager.js';
export { photoMessages } from './photos/messages.js';
export {
    MAX_RECIPE_PHOTOS,
    admitPhotoBatch,
    isAtPhotoCap,
    remainingPhotoSlots,
    visibleQueueItems,
} from './photos/model.js';
export type { RecipePhotoAdmission } from './photos/model.js';
export type { PhotoMessages } from './photos/messages.js';
export type { RecipePhotoManagerProps } from './photos/model.js';
export { AppliedFilters } from './filters/AppliedFilters.js';
export { FilterPanel } from './filters/FilterPanel.js';
export { FilterSheet } from './filters/FilterSheet.js';
export { FilterTrigger } from './filters/FilterTrigger.js';
export { filterBarViewOf } from './filters/filterBarView.js';
export { filterPresentationOf } from './filters/filterPresentation.js';
export { useFilterPresentation } from './filters/useFilterPresentation.js';
export type { FilterPresentation } from './filters/filterPresentation.js';
export type { FilterBarView } from './filters/filterBarView.js';
export type {
    AppliedFiltersProps,
    FilterPanelProps,
    FilterSheetProps,
    FilterTriggerProps,
} from './filters/filtersModel.js';
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
    RecipeFilterState,
    RecipeIngredientFilter,
    RecipeIngredientSearchState,
    TimeBoundField,
} from './filters/model.js';
// The Data sources page (plan R55, design §S16): the web screen, which reads food-service itself. Profile opens it. The
// native entry is `./data-sources/mobile`, because its props differ.
export { DataSourcesScreen } from './dataSources/DataSourcesScreen.js';
// The one-page editor (UI overhaul slice 7): the web view (the native leaf resolves at bundle time), its section
// Registry, the device draft store, and the observer that records the outbox's answers in it while the editor is closed.
export { RecipeEditorView } from './editor/RecipeEditorView.js';
export type { RecipeEditorViewProps } from './editor/frameProps.js';
export { EDITOR_SECTIONS, isEditorSectionId, sectionFromHash } from './editor/sections.js';
export type { EditorSectionId } from './editor/sections.js';
export { draftStoreFor } from './editor/draftStore.js';
export { visibilityFollowUp } from './editor/visibilityFollowUp.js';
export type { DraftMemento, DraftStore } from './editor/draftStore.js';
export { useDraftAnswers } from './editor/useDraftAnswers.js';
export { editorMessages } from './editor/messages.js';
export type { GateOutcome } from './editor/gate.js';
export { RecipePreviewSheet } from './editor/RecipePreviewSheet.js';
export type { RecipePreviewSheetProps } from './editor/previewSheetProps.js';
export { previewRecipeOf } from './editor/previewRecipe.js';
export { PasteStepsControl } from './form/PasteStepsControl.js';
export type { PasteStepsControlProps } from './form/PasteStepsControl.js';
export { PasteListSheet } from './form/PasteListSheet.js';
export type { PasteListSheetProps } from './form/pasteListSheetProps.js';
export { useIngredientsPaste } from './editor/useIngredientsPaste.js';
export type { IngredientsPaste, UseIngredientsPasteOptions } from './editor/useIngredientsPaste.js';
export { splitPastedSteps } from './form/pasteSteps.js';
export type { RecipeEditorSectionProps, RecipeVisibilityFieldProps } from './form/props.js';
