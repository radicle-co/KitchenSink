'use client';

/**
 * @module components/app/RouteLoadingState — the shared, localized presentational Suspense fallback
 * rendered by every web App Router `loading.tsx` boundary (B18). Pure `props → JSX` (no props at all): shown
 * while a route segment's server render (params/auth) resolves, before the client container underneath
 * mounts and takes over its own query-driven loading state.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/**
 * Localized loading status, shared by every route's `loading.tsx`.
 *
 * The label is the region's CONTENT, not only its `aria-label`: an empty `role="status"` node is zero-height
 * (nothing for a sighted viewer, and Playwright resolves it as `hidden`) AND silent, because a live region
 * announces its CONTENT, not its label. So the localized label doubles as the visible caption.
 */
export const RouteLoadingState: FC = () => {
    const { boundary } = useMessages(webMessages);

    return (
        <p
            role="status"
            aria-label={boundary.loading.label}
            className="mx-auto w-full max-w-4xl py-12 text-body-md text-slate"
        >
            {boundary.loading.label}
        </p>
    );
};
