/**
 * Loading boundary for the recipe-detail route segment (`/[locale]/recipes/[id]`, B18). Delegates to the
 * shared {@link RouteLoadingState}.
 */
import { RouteLoadingState } from '@/components/app/RouteLoadingState';

export default function RecipeDetailLoading(): React.JSX.Element {
    return <RouteLoadingState />;
}
