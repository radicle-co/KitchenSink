'use client';

/**
 * @module components/app/RouteErrorState — the shared, localized presentational fallback rendered by every
 * web App Router `error.tsx` boundary (B18). Pure `props → JSX`: the retry affordance is the caller's
 * `onRetry` (Next's own `reset()` for the segment) — this component does not know about React error
 * boundaries, DA9 reporting, or which segment threw; that orchestration lives in
 * `RouteErrorBoundary`, the shared composition point every
 * per-segment `error.tsx` renders.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RouteErrorState}. */
export interface RouteErrorStateProps {
    /** Invoked when the viewer asks to retry — Next's `reset()` for the segment. */
    readonly onRetry: () => void;
}

/** Localized "this page failed to load" state with a retry affordance, shared by every route's `error.tsx`. */
export const RouteErrorState: FC<RouteErrorStateProps> = ({ onRetry }) => {
    const { boundary } = useMessages(webMessages);

    return (
        <div role="alert" className="mx-auto flex w-full max-w-4xl flex-col items-start gap-3 py-12">
            <p className="text-heading-sm font-semibold text-charcoal">{boundary.error.title}</p>
            <p className="text-body-sm text-slate">{boundary.error.description}</p>
            <button type="button" onClick={onRetry}>
                {boundary.error.retry}
            </button>
        </div>
    );
};
