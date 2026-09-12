/**
 * @module @commise/query/boundary — the ONE boundary a suspense read sits under, on web and native alike.
 *
 * A `useSuspenseQuery` read has three render-time outcomes, and each belongs to exactly one layer: while it is
 * PENDING, `Suspense` renders `loading`; if it FAILS, `react-error-boundary`'s `ErrorBoundary` renders
 * `renderError`; once SETTLED, the children render with data guaranteed. The leaf under it never learns fetch
 * state, and the boundary never learns copy — the caller supplies both fallbacks, reusing the surface's existing
 * skeleton and error body.
 *
 * ⛔ TanStack's `QueryErrorResetBoundary` is composed INTO the error boundary's reset, not beside it. A query that
 * threw into a boundary keeps `retryOnMount` off until that reset boundary is reset, so a bare `ErrorBoundary`'s
 * "Try again" re-renders straight back into the same cached failure. Here `resetErrorBoundary` resets the query
 * errors first, so a retry refetches.
 *
 * Platform-neutral: it renders no host element, so the same module serves web and React Native.
 *
 * @pattern Composite boundary — Error Boundary ∘ Suspense: a render-time pending / pending-offline / failed /
 *     settled state machine, with TanStack's query-error reset composed into the error boundary's reset and the
 *     pending leg decorated by `PendingSlot`.
 */
import { QueryErrorResetBoundary } from '@tanstack/react-query';

import { PendingSlot } from './pendingSlot.js';
import { Suspense, type ErrorInfo, type ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

/** Props for {@link QueryBoundary}. */
export interface QueryBoundaryProps {
    /** What renders while a read under this boundary is pending — the surface's existing skeleton. */
    readonly loading: ReactNode;
    /**
     * What renders when a read fails; its `resetErrorBoundary` retries (and refetches). A render function rather than
     * a component, so a surface's failure body can close over the surface's own props — a Back control bound to its
     * navigator — without a component type created per render, which would remount the fallback every time.
     */
    readonly renderError: (fallback: FallbackProps) => ReactNode;
    /** Report a failure — the surface's error reporter. */
    readonly onError?: (error: unknown, info: ErrorInfo) => void;
    /** Values whose change clears a shown failure, e.g. the id of the recipe being read. */
    readonly resetKeys?: readonly unknown[];
    /** The subtree that reads. */
    readonly children: ReactNode;
}

/** The suspense read boundary: loading while pending, a retrying error fallback when failed, children once settled. */
export function QueryBoundary({ loading, renderError, onError, resetKeys, children }: QueryBoundaryProps): ReactNode {
    return (
        <QueryErrorResetBoundary>
            {({ reset }) => (
                <ErrorBoundary
                    fallbackRender={renderError}
                    onReset={reset}
                    {...(onError === undefined ? {} : { onError })}
                    {...(resetKeys === undefined ? {} : { resetKeys: [...resetKeys] })}
                >
                    {/* The pending node goes through `PendingSlot`, which upgrades it to the app's offline
                        copy when a read is PARKED and the device is offline — §11.0's "Suspense owns pending"
                        applied to the one pending state nothing used to own. With no offline provider mounted
                        the slot is the identity function, so this renders exactly `loading`, as before. */}
                    <Suspense fallback={<PendingSlot>{loading}</PendingSlot>}>{children}</Suspense>
                </ErrorBoundary>
            )}
        </QueryErrorResetBoundary>
    );
}
