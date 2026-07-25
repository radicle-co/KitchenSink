'use client';

/**
 * @module components/app/RouteErrorBoundary — the shared orchestration every web App Router `error.tsx`
 * boundary delegates to (B18). Composes the DA9 {@link ErrorReporter} seam (never a hard-coded Sentry
 * import at the call site) with the pure {@link RouteErrorState} presentational fallback: reporting is a
 * side effect a segment's `error.tsx` MUST perform (a route crash must never be silent), kept out of the
 * pure presentational component per the app's pure-render-component rule (`@sideEffect`).
 *
 * Resolves the reporter from the SAME appShell container the Home-widget boundaries already bind
 * (`homeContainer`, DA9) rather than introducing a second Sentry binding path — until the DA10 AppProviders
 * facade gives the whole app one composition root, `homeContainer` is the ONE bound `errorReporterToken` on
 * web, so every observability call site (widget or route) composes with it.
 */
import { resolveErrorReporter } from '@commise/features-core';
import { useEffect, type FC } from 'react';

import { homeContainer } from '@/components/home/homeContainer';

import { RouteErrorState } from './RouteErrorState';

/** The DA9 reporter resolved once from the shared appShell container (bound to Sentry in production). */
const reportRouteError = resolveErrorReporter(homeContainer);

/** Props for {@link RouteErrorBoundary} — the exact shape Next.js hands every `error.tsx`, plus the route
 * name attached to the report for triage. */
export interface RouteErrorBoundaryProps {
    /** The error Next.js caught rendering this route segment. */
    readonly error: Error & { digest?: string };
    /** Next's recovery affordance — re-renders the segment. */
    readonly reset: () => void;
    /** The route segment name attached to the DA9 report (e.g. `'recipes'`), for triage. */
    readonly routeName: string;
}

/**
 * Reports the caught error via DA9 and renders the shared localized fallback with retry wired to `reset`.
 *
 * @sideEffect Reports `error` through the injected {@link ErrorReporter} seam on every render of a new error.
 */
export const RouteErrorBoundary: FC<RouteErrorBoundaryProps> = ({ error, reset, routeName }) => {
    useEffect(() => {
        reportRouteError(error, { route: routeName });
    }, [error, routeName]);

    return <RouteErrorState onRetry={reset} />;
};
