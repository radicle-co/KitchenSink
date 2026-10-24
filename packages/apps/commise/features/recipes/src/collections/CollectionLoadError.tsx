/**
 * @module @commise/features-recipes/collections — `CollectionLoadError`: what a collection read's boundary renders when
 * the read fails. A 404 is final (the collection was deleted, or is not the viewer's), so it says why and offers no retry;
 * any other failure is the generic one, whose retry is the boundary's reset, which refetches. The host names the way back, because only it knows
 * where back goes, and passes it only for a missing collection.
 *
 * ONE file for both apps: the design system's `StateNotice` is a platform pair, so the web page gets an alert in its flow
 * and the mobile screen gets the thumb-reach stack. It replaces the web app's raw-`<button>` copy and the mobile screen's
 * hand-built fallback.
 *
 * @pattern Adapter over the design system's `StateNotice` — picks the copy and whether a retry is on offer from the error
 */
import { useMessages } from '@commise/i18n/react';
import type { HeaderBack } from '@commise/ui/large-title-header';
import { StateNotice } from '@commise/ui/state-notice';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';

/** Props for {@link CollectionLoadError}. */
export interface CollectionLoadErrorProps {
    /** What the read failed with. */
    readonly error: unknown;
    /** Read again: the boundary's reset. */
    readonly onRetry: () => void;
    /**
     * The way back, the same value the host hands the pinned bar. Required, so a host cannot forget it; drawn ONLY for a
     * missing collection (`isNotFoundError`), where it is the one next step and sits in reach. A generic failure keeps Try
     * again only, because the bar owns Back there (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §5).
     */
    readonly back: HeaderBack;
}

/** A collection read failed: presentational, props → JSX. */
export const CollectionLoadError: FC<CollectionLoadErrorProps> = ({ error, onRetry, back }) => {
    const { detail } = useMessages(collectionMessages);
    const notFound = isNotFoundError(error);

    return (
        <StateNotice
            title={notFound ? detail.notFoundTitle : detail.errorTitle}
            {...(notFound
                ? {
                      body: detail.notFoundBody,
                      secondary: {
                          label: back.label,
                          icon: 'chevronLeft',
                          onPress: back.onPress,
                          ...(back.href === undefined ? {} : { href: back.href }),
                      },
                  }
                : { primary: { label: detail.retry, icon: 'refreshCw', onPress: onRetry } })}
        />
    );
};
