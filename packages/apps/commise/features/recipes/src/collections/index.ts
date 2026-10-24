/**
 * @module @commise/features-recipes/collections — the collections list and detail screens' shared controllers.
 *
 * A package-export entry (the one kind of barrel this repo keeps): web's `CollectionListContainer` /
 * `CollectionDetailContainer` and mobile's `CollectionsScreen` / `CollectionDetailScreen` each keep their route frame, read
 * boundary and navigation, and take everything else from here.
 */
export { collectionListRowsOf } from './collectionListRows.js';
export type { CollectionListLoadMore, CollectionListQuery, CollectionListRows } from './collectionListRows.js';
export { CollectionDetailBody } from './CollectionDetailBody.js';
export type {
    CollectionDetailBodyProps,
    CollectionDetailLinks,
    CollectionPickerBoundaryProps,
} from './CollectionDetailBody.js';
export { useCollectionDetail } from './useCollectionDetail.js';
export type { CollectionDetail, CollectionDetailInput, CollectionDetailNav } from './useCollectionDetail.js';
export { useCollectionsList } from './useCollectionsList.js';
export type { CollectionsList, CollectionsListInput } from './useCollectionsList.js';
export { CollectionMoreMenu } from './CollectionMoreMenu.js';
export { COLLECTION_TITLE_ID, collectionMenuPropsOf, collectionsBackOf } from './detailModel.js';
export type { CollectionMoreMenuProps } from './detailModel.js';
export { CollectionLoadError } from './CollectionLoadError.js';
export type { CollectionLoadErrorProps } from './CollectionLoadError.js';
