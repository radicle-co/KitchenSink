'use client';

/**
 * Error boundary for the cook route segment (`/[locale]/recipes/[id]/cook`). Only an error the page's own read boundary
 * did not catch reaches here (a read failure is the screen's S29 or S32); it delegates to the shared
 * {@link RouteErrorBoundary}, as the recipe page does.
 */
import { RouteErrorBoundary } from '@/components/app/RouteErrorBoundary';

export default function CookingError({
    error,
    retry,
}: {
    readonly error: Error & { digest?: string };
    readonly retry: () => void;
}): React.JSX.Element {
    return <RouteErrorBoundary error={error} retry={retry} routeName="cooking-mode" />;
}
