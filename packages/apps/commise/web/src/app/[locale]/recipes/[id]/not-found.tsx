/**
 * Not-found boundary for the recipe-detail route segment (`/[locale]/recipes/[id]`, B18) — catches an
 * unmatched sub-path under a recipe id (e.g. `/en/recipes/abc/typo`, neither `edit` nor `versions`), which
 * previously fell through to Next's unstyled default 404. (A missing/inaccessible RECIPE — the query 404 —
 * is a distinct, already-handled state owned by `RecipeDetailContainer`'s own localized not-found render;
 * this boundary is the framework-level fallback for a route that plain doesn't exist, not that case.)
 * Delegates to the shared {@link RouteNotFoundState}.
 */
import { RouteNotFoundState } from '@/components/app/RouteNotFoundState';

export default function RecipeDetailNotFound(): React.JSX.Element {
    return <RouteNotFoundState />;
}
