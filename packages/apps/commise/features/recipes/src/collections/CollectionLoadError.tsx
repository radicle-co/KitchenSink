/**
 * @module @commise/features-recipes/collections — `CollectionLoadError`: what a collection read's boundary renders when
 * the read fails. A 404 is final (the collection was deleted, or is not the viewer's), so it says why and offers no retry;
 * any other failure is the generic one, whose retry is the boundary's reset, which refetches. Both keep a way back, which
 * the host names because only it knows where back goes.
 *
 * ONE file for both apps: the design system's `StateNotice` is a platform pair, so the web page gets an alert in its flow
 * and the mobile screen gets the thumb-reach stack. It replaces the web app's raw-`<button>` copy and the mobile screen's
 * hand-built fallback.
 *
 * @pattern Adapter over the design system's `StateNotice` — picks the copy and whether a retry is on offer from the error
 */
import { useMessages } from '@commise/i18n/react';
import { StateNotice, type StateNoticeAction } from '@commise/ui/state-notice';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';

/** Props for {@link CollectionLoadError}. */
export interface CollectionLoadErrorProps {
    /** What the read failed with. */
    readonly error: unknown;
    /** Read again: the boundary's reset. */
    readonly onRetry: () => void;
    /** The way back, if the host has one. */
    readonly back?: StateNoticeAction;
}

/** A collection read failed: presentational, props → JSX. */
export const CollectionLoadError: FC<CollectionLoadErrorProps> = ({ error, onRetry, back }) => {
    const { detail } = useMessages(collectionMessages);
    const notFound = isNotFoundError(error);

    return (
        <StateNotice
            title={notFound ? detail.notFoundTitle : detail.errorTitle}
            {...(notFound
                ? { body: detail.notFoundBody }
                : { primary: { label: detail.retry, icon: 'refreshCw', onPress: onRetry } })}
            {...(back === undefined ? {} : { secondary: back })}
        />
    );
};
