/**
 * @module @commise/features-recipes/collections — platform-neutral barrel for the collections building
 * blocks (T071–T073): list, detail (with member add/remove + rename/delete), and the create/rename form.
 * Each component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time;
 * the model + message layers are platform-agnostic. The apps compose these into their collections pages.
 */
export { CloneInfoPanel } from './CloneInfoPanel.js';
export { CollectionActions } from './CollectionActions.js';
export { CollectionList } from './CollectionList.js';
export { CollectionDetail } from './CollectionDetail.js';
export { CollectionForm } from './CollectionForm.js';
export { CollectionHeader } from './CollectionHeader.js';
export { CollectionRecipePicker } from './CollectionRecipePicker.js';

export {
    formatCollectionDate,
    type CloneInfoPanelProps,
    type CollectionActionsProps,
    type CollectionDetailError,
    type CollectionDetailViewProps,
    type CollectionFormMode,
    type CollectionFormProps,
    type CollectionHeaderViewProps,
    type CollectionListStatus,
    type CollectionListViewProps,
    type CollectionRecipePickerProps,
    type CollectionWithRecipes,
    type RecipePickerStatus,
} from './model.js';

export { collectionMessages } from './messages.js';
export type { CloneInfoPanelMessages, CollectionMessages } from './messages.js';
