'use client';

/**
 * Error boundary for the recipe-detail route segment (`/[locale]/recipes/[id]`, B18). Delegates to the
 * shared {@link RouteErrorBoundary} (DA9-reported + retry via `reset()`).
 */
import { RouteErrorBoundary } from '@/components/app/RouteErrorBoundary';

export default function RecipeDetailError({
    error,
    reset,
}: {
    readonly error: Error & { digest?: string };
    readonly reset: () => void;
}): React.JSX.Element {
    return <RouteErrorBoundary error={error} reset={reset} routeName="recipe-detail" />;
}
