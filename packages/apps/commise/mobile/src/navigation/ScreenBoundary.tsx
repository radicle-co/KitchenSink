/**
 * @module navigation/ScreenBoundary — the crash boundary around every routed screen (B18; `buildSpec.md` §3.8): a render
 * crash shows the localized, recoverable fallback IN PLACE of that screen, with the tab bar still under it, instead of
 * a white screen. "Try again" re-renders the screen and resets TanStack's query errors, so a failed read refetches;
 * "Back to Home" is offered everywhere but Home itself, where it would only repeat "Try again". Leaving the screen
 * unmounts the failure with it. Reports through the SAME `errorReporterToken` seam the Home widgets use (DA9).
 *
 * ORCHESTRATION: it owns the recovery (reset, query-error reset, go Home); the fallback it shows is presentational.
 *
 * @pattern Bulkhead — one crash boundary per routed screen, so a failure stays inside the screen that threw
 */
import { resolveErrorReporter } from '@commise/features-core';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { RootErrorFallback } from '../components/RootErrorFallback.js';
import { homeContainer } from '../components/home/homeContainer.js';
import { resetToHome } from './navigationRef.js';

/** The DA9 reporter resolved once from the shared appShell container (bound to Sentry in production). */
const reportScreenError = resolveErrorReporter(homeContainer);

/** Props for {@link ScreenBoundary}. */
export interface ScreenBoundaryProps {
    /** Whether this screen IS Home's root, where "Back to Home" is not offered. */
    readonly atHome: boolean;
    readonly children: ReactNode;
}

/**
 * @param props - Whether the screen is Home, and the screen.
 * @returns The screen, or its recoverable fallback.
 */
export function ScreenBoundary({ atHome, children }: ScreenBoundaryProps): JSX.Element {
    const { reset: resetQueryErrors } = useQueryErrorResetBoundary();

    return (
        <ErrorBoundary
            fallbackRender={(fallback) => (
                <RootErrorFallback
                    {...fallback}
                    {...(atHome
                        ? {}
                        : {
                              onBackToHome: () => {
                                  resetToHome();
                                  fallback.resetErrorBoundary();
                              },
                          })}
                />
            )}
            onReset={resetQueryErrors}
            onError={(error) => reportScreenError(error, { boundary: 'root' })}
        >
            {children}
        </ErrorBoundary>
    );
}
