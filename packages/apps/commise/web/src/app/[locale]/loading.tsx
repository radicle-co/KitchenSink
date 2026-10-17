'use client';

/**
 * Segment-level default loading boundary for `/[locale]` (B18) — the Suspense fallback shown while the
 * server render (params/auth) of a route with no more specific `loading.tsx` resolves. It draws the shared
 * `LoadingNotice` (specSharedSystem.md §18). This root cannot know what it is loading, so its caption is the one bare
 * "Loading…"; the label comes from a client hook, hence `'use client'`.
 */
import { useMessages } from '@commise/i18n/react';
import { LoadingNotice } from '@commise/ui/loading-notice';

import { webMessages } from '@/i18n/messages';

export default function LocaleLoading(): React.JSX.Element {
    const { boundary } = useMessages(webMessages);

    return <LoadingNotice label={boundary.loading.label} />;
}
