/**
 * Loading boundary for the recipe-list route segment (`/[locale]/recipes`, B18). Delegates to the shared
 * {@link RouteLoadingState}.
 */
import { RouteLoadingState } from '@/components/app/RouteLoadingState';

export default function RecipesLoading(): React.JSX.Element {
    return <RouteLoadingState />;
}
