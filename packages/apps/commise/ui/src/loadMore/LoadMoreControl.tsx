/**
 * @module @commise/ui/load-more — the web "Load more" control of a server-paged list (no infinite scroll).
 *
 * Three states over ONE button element: idle ("Load more"), busy (the next page is in flight) and failed ("Try
 * again", with a message saying what happened). The element is never swapped between states, because the cook who
 * pressed it holds focus on it — a swapped element drops that focus to <body> (WCAG 2.2 SC 2.4.3). The busy half is
 * `busyControlProps`, for the same reason.
 *
 * The failure message is an `alert` mounted EMPTY above the button, so a failure announces when its text appears;
 * a retry in flight clears it, so a second failure announces again. The pages already loaded are the caller's and
 * stay on screen: this control reports a failed NEXT page, never a failed list.
 *
 * A presentational leaf: the caller derives `loading` and `failed` from its infinite query.
 *
 * @pattern Facade over one button and its empty `alert` message slot, with the busy half delegated to
 *     `busyControlProps`
 */
import { useId, type FC } from 'react';

import { BUSY_CONTROL_CLASS, busyControlProps } from '../button/busyControlProps.js';
import type { LoadMoreControlProps } from './props.js';

/** The explicit next-page control, with its busy and failed states. */
export const LoadMoreControl: FC<LoadMoreControlProps> = ({ hasMore, loading, failed, onLoadMore, labels }) => {
    const messageId = useId();

    if (!hasMore) {
        return null;
    }

    const showFailure = failed && !loading;

    return (
        <div className="flex flex-col items-center gap-2">
            <p id={messageId} role="alert" className="text-center text-body-sm text-slate empty:sr-only">
                {showFailure ? labels.failed : ''}
            </p>
            <button
                type="button"
                {...busyControlProps({ busy: loading, onClick: onLoadMore })}
                aria-describedby={showFailure ? messageId : undefined}
                className={`inline-flex min-h-11 items-center justify-center rounded-full bg-pearl px-6 py-2.5 text-body-sm font-semibold text-charcoal transition hover:bg-mist/40 md:min-h-0 ${BUSY_CONTROL_CLASS}`}
            >
                {loading ? labels.loadingMore : failed ? labels.retry : labels.loadMore}
            </button>
        </div>
    );
};
