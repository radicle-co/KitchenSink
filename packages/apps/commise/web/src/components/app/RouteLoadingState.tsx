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

/** Localized loading status, shared by every route's `loading.tsx`. */
export const RouteLoadingState: FC = () => {
    const { boundary } = useMessages(webMessages);

    return <div role="status" aria-label={boundary.loading.label} />;
};
