/**
 * Loading boundary for the collection-list route segment (`/[locale]/collections`, B18). Delegates to the
 * shared {@link RouteLoadingState}.
 */
import { RouteLoadingState } from '@/components/app/RouteLoadingState';

export default function CollectionsLoading(): React.JSX.Element {
    return <RouteLoadingState />;
}
