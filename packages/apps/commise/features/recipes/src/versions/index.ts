/**
 * @module @commise/features-recipes/versions — platform-neutral barrel for the version-history (T069) and
 * concurrent-edit conflict (T070) building blocks. Each component specifier resolves to its web (`*.tsx`)
 * or native (`*.native.tsx`) leaf at bundle time; the model layer is platform-agnostic. The apps compose
 * these into their recipe version-history and conflict-resolution surfaces.
 */
export { RecipeVersionList } from './RecipeVersionList.js';
export { RecipeConflictView } from './RecipeConflictView.js';

export { diffSnapshots, type SnapshotDiff, type SnapshotFieldKey } from './diff.js';
export {
    buildRecipeMergeFields,
    composeMergedRecipe,
    formatVersionTimestamp,
    sortVersionsDescending,
    toConflictSideFields,
    type ConflictField,
    type MergeSide,
    type RecipeConflictViewProps,
    type RecipeMergeField,
    type RecipeMergeSelections,
    type RecipeVersionListProps,
    type RecipeVersionRestoreError,
} from './model.js';
export {
    recipeVersionMessages,
    type RecipeConflictMessages,
    type RecipeVersionListMessages,
    type RecipeVersionMessages,
} from './messages.js';
