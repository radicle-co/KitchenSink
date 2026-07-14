/**
 * Collections list screen (mobile, T071). Drives the shared native `CollectionList` building block from
 * `useCollections`, mapping the query's loading/error/ready state to the view's status and deriving the rows
 * from the paginated cache (never copying server data into local state). Selection and create intents are
 * forwarded upward; the block owns the empty and error presentations (retry re-runs the query).
 */
import { CollectionList, type CollectionListStatus } from '@commise/features-recipes';
import { useCollections } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';

/** Props for {@link CollectionsScreen}. */
export interface CollectionsScreenProps {
    /** Invoked with a collection id when a row is activated. */
    readonly onSelect: (collectionId: string) => void;
    /** Invoked when the create-collection action is activated. */
    readonly onCreate: () => void;
}

/**
 * The collections list screen.
 *
 * @param props - The select + create callbacks the navigator wires.
 * @returns The collection-list view.
 */
export function CollectionsScreen({ onSelect, onCreate }: CollectionsScreenProps): JSX.Element {
    const query = useCollections();

    const status: CollectionListStatus = query.isError ? 'error' : query.isLoading ? 'loading' : 'ready';

    return (
        <CollectionList
            status={status}
            collections={query.data?.data ?? []}
            onSelect={onSelect}
            onCreate={onCreate}
            onRetry={() => void query.refetch()}
        />
    );
}
