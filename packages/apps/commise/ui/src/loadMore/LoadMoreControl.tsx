/**
 * @module @commise/ui/load-more — the web "Load more" control of a server-paged list (no infinite scroll).
 *
 * Three states over ONE button element: idle ("Load more", an `actionText` label with a chevronDown after it, so colour
 * and glyph mark it pressable), busy (the next page is in flight) and failed ("Try
 * again", with a message saying what happened). The element is never swapped between states, because the cook who
 * pressed it holds focus on it — a swapped element drops that focus to <body> (WCAG 2.2 SC 2.4.3). The busy half is
 * `Button`'s (`busyControlProps`), for the same reason.
 *
 * The failure message is an `alert` mounted EMPTY above the button, so a failure announces when its text appears;
 * a retry in flight clears it, so a second failure announces again. The pages already loaded are the caller's and
 * stay on screen: this control reports a failed NEXT page, never a failed list.
 *
 * A presentational leaf: the caller derives `loading` and `failed` from its infinite query.
 *
 * @pattern Facade over the design system's ghost (idle, busy) and quiet (failed) `Button` and an empty `alert` message slot — the radius, the busy and
 *     the disabled states, and the failure reason's description, all come from `Button`
 */
import type { FC } from 'react';

import { Button } from '../button/Button.js';
import type { LoadMoreControlProps } from './props.js';

/** The explicit next-page control, with its busy and failed states. */
export const LoadMoreControl: FC<LoadMoreControlProps> = ({ hasMore, loading, failed, onLoadMore, labels }) => {
    if (!hasMore) {
        return null;
    }

    const showFailure = failed && !loading;

    return (
        <div className="flex flex-col items-center gap-2">
            <p role="alert" className="text-center text-body-sm text-ink-muted empty:sr-only">
                {showFailure ? labels.failed : ''}
            </p>
            {/* ONE element in every state: the cook who pressed it holds focus on it (SC 2.4.3). */}
            <Button
                variant={failed ? 'quiet' : 'ghost'}
                busy={loading}
                onPress={onLoadMore}
                {...(failed
                    ? { icon: 'refreshCw' as const }
                    : { icon: 'chevronDown' as const, iconPlacement: 'end' as const })}
                {...(showFailure ? { description: labels.failed } : {})}
            >
                {loading ? labels.loadingMore : failed ? labels.retry : labels.loadMore}
            </Button>
        </div>
    );
};
