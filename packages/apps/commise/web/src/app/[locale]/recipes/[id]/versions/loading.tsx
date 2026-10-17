/**
 * Loading boundary for the version-history route segment (`/[locale]/recipes/[id]/versions`, D3). Its parent segment's
 * boundary is the recipe page's skeleton, which is the wrong shape here; this one is the history's, the same the page's
 * own query boundary shows.
 */
import { RecipeVersionsRouteLoading } from '@/components/recipes/RecipeVersionsRouteLoading';

export default function RecipeVersionsLoading(): React.JSX.Element {
    return <RecipeVersionsRouteLoading />;
}
