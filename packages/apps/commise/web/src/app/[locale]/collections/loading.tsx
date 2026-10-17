'use client';

/**
 * Loading boundary for the collection-list route segment (`/[locale]/collections`, B18). It keeps the shared
 * `LoadingNotice`, not `CollectionListLoading`: that skeleton's stacked rows do not match this route's three-column
 * grid, so they would reflow instead of reserving the space (specSharedSystem.md §18). The label comes from a client
 * hook, hence `'use client'`.
 */
import { collectionMessages } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { LoadingNotice } from '@commise/ui/loading-notice';

export default function CollectionsLoading(): React.JSX.Element {
    const { list } = useMessages(collectionMessages);

    return <LoadingNotice label={list.loadingLabel} />;
}
