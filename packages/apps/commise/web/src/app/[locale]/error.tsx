'use client';

/**
 * Segment-level default error boundary for `/[locale]` (B18). Catches a render crash from any route under
 * the locale that does not have its own more specific `error.tsx` (the recipe/discover/collections data
 * segments each have one — see their local `error.tsx`). Delegates to the shared {@link RouteErrorBoundary}
 * (DA9-reported + retry via `reset()`).
 */
import { RouteErrorBoundary } from '@/components/app/RouteErrorBoundary';

export default function LocaleError({
    error,
    reset,
}: {
    readonly error: Error & { digest?: string };
    readonly reset: () => void;
}): React.JSX.Element {
    return <RouteErrorBoundary error={error} reset={reset} routeName="locale" />;
}
