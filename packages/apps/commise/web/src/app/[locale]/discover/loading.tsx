/**
 * Loading boundary for the public-discovery route segment (`/[locale]/discover`, B18). Delegates to the
 * shared {@link RouteLoadingState}.
 */
import { RouteLoadingState } from '@/components/app/RouteLoadingState';

export default function DiscoverLoading(): React.JSX.Element {
    return <RouteLoadingState />;
}
