/**
 * Loading boundary for the recipe-detail route segment (`/[locale]/recipes/[id]`, B18, D3). This segment settles into the
 * recipe page, so its boundary reserves that page's shape — the same skeleton the page's own query boundary shows — rather
 * than a line of text the page then reflows past. Its two child segments, which settle into other things, have their own.
 */
import { RecipeDetailRouteLoading } from '@/components/recipes/RecipeDetailRouteLoading';

export default function RecipeDetailLoading(): React.JSX.Element {
    return <RecipeDetailRouteLoading />;
}
