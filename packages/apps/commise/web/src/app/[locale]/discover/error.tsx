'use client';

/**
 * Error boundary for the public-discovery route segment (`/[locale]/discover`, B18). Delegates to the
 * shared {@link RouteErrorBoundary} (DA9-reported + retry that re-fetches via `retry()`).
 */
import { RouteErrorBoundary } from '@/components/app/RouteErrorBoundary';

export default function DiscoverError({
    error,
    retry,
}: {
    readonly error: Error & { digest?: string };
    readonly retry: () => void;
}): React.JSX.Element {
    return <RouteErrorBoundary error={error} retry={retry} routeName="discover" />;
}
