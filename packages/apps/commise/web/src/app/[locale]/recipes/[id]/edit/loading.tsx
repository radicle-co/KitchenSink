/**
 * Loading boundary for the recipe-editor route segment (`/[locale]/recipes/[id]/edit`). Its parent segment's boundary is the
 * recipe page's skeleton, which is the wrong shape for the editor; until the editor has a skeleton of its own, this keeps
 * the shared text fallback the segment had before the parent changed.
 */
import { RouteLoadingState } from '@/components/app/RouteLoadingState';

export default function RecipeEditLoading(): React.JSX.Element {
    return <RouteLoadingState />;
}
