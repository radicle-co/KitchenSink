/**
 * @module @commise/features-recipes/versions — platform-neutral barrel for the version-history (T069) and
 * concurrent-edit conflict (T070) building blocks. Each component specifier resolves to its web (`*.tsx`)
 * or native (`*.native.tsx`) leaf at bundle time; the model layer is platform-agnostic. The apps compose
 * these into their recipe version-history and conflict-resolution surfaces.
 */
export { RecipeVersionList } from './RecipeVersionList.js';
export { RecipeConflictView } from './RecipeConflictView.js';
export { VersionPreviewModal } from './VersionPreviewModal.js';
export { VersionCompareView } from './VersionCompareView.js';

export { diffSnapshots, type DiffTally, type SnapshotDiff, type SnapshotFieldKey } from './diff.js';
export {
    computeConflictDiff,
    type ConflictDiff,
    type ConflictFieldKind,
    type ConflictFieldRow,
    type ConflictMarker,
} from './conflictDiff.js';
export {
    applyServerSnapshotToRecipeDetail,
    buildCompareFieldRows,
    buildRecipeMergeFields,
    changedFromCurrentCounts,
    compareViewState,
    composeConflictMerge,
    composeMergedRecipe,
    draftToSnapshot,
    formatChangedFromCurrent,
    formatCollectionTally,
    formatVersionTimestamp,
    snapshotFieldLabel,
    sortVersionsDescending,
    toConflictSideFields,
    toVersionPreviewIngredientLines,
    type CompareFieldRow,
    type ConflictField,
    type MergeSide,
    type RecipeConflictViewProps,
    type RecipeMergeField,
    type RecipeMergeSelections,
    type RecipeVersionListProps,
    type RecipeVersionRestoreError,
    type VersionCompareState,
    type VersionCompareViewProps,
    type VersionPreviewIngredientLine,
    type VersionPreviewModalProps,
} from './model.js';
export {
    recipeVersionMessages,
    type RecipeConflictMessages,
    type RecipeVersionCompareMessages,
    type RecipeVersionListMessages,
    type RecipeVersionMessages,
    type RecipeVersionPreviewMessages,
} from './messages.js';
