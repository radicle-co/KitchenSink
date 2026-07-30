'use client';

/**
 * Error boundary for the recipe-list route segment (`/[locale]/recipes`, B18). Delegates to the shared
 * {@link RouteErrorBoundary} (DA9-reported + retry via `reset()`).
 */
import { RouteErrorBoundary } from '@/components/app/RouteErrorBoundary';

export default function RecipesError({
    error,
    reset,
}: {
    readonly error: Error & { digest?: string };
    readonly reset: () => void;
}): React.JSX.Element {
    return <RouteErrorBoundary error={error} reset={reset} routeName="recipes" />;
}
