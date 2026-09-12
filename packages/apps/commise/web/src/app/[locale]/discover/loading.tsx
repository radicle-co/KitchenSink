/**
 * Loading boundary for the public-discovery route segment (`/[locale]/discover`, B18). Delegates to the
 * shared {@link RecipeGridRouteLoading} — this segment settles into a recipe-card GRID, so its boundary
 * reserves that grid rather than painting a line of text the cards then reflow past.
 */
import { RecipeGridRouteLoading } from '@/components/recipes/RecipeGridRouteLoading';

export default function DiscoverLoading(): React.JSX.Element {
    return <RecipeGridRouteLoading />;
}
