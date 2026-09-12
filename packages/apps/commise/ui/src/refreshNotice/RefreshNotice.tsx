/**
 * @module @commise/ui/refresh-notice — the web notice for a failed refresh of data that stays on screen.
 *
 * While nothing has failed it renders only a `status` region, mounted EMPTY, so a failure announces when its text
 * appears. On failure the region says what happened and a visible row shows the same message with a Try again
 * button. The rows the viewer is reading are still valid, so the region is POLITE — unlike `LoadMoreControl`'s
 * assertive alert, which reports an action the viewer just took failing.
 *
 * A retry in flight keeps the message and the SAME button (busy through `busyControlProps`): unmounting the pressed
 * button would drop its focus to `<body>` (WCAG 2.2 SC 2.4.3). Only the announcement clears, so a second failure is
 * announced again. A successful refresh removes the row; where focus goes then is the surface's decision, because
 * only the surface knows what it would land on.
 *
 * The button carries a `mist` hairline: its `sand` fill is ~1:1 against the `pearl` row, so without it a text-only
 * control reads as bold text rather than something pressable. Decorative — the visible label is what identifies it.
 *
 * A presentational leaf: the caller derives `failed` and `refreshing` from its query.
 *
 * @pattern Facade over a busy button and a polite `status` region, with the busy half delegated to
 *     `busyControlProps`
 */
import { useId, type FC } from 'react';

import { BUSY_CONTROL_CLASS, busyControlProps } from '../button/busyControlProps.js';
import type { RefreshNoticeProps } from './props.js';

/** The failed-refresh notice: a silent region until a refresh fails, then the message and its retry. */
export const RefreshNotice: FC<RefreshNoticeProps> = ({ failed, refreshing, onRetry, labels }) => {
    const messageId = useId();

    return (
        <>
            <p role="status" className="sr-only">
                {failed && !refreshing ? labels.failed : ''}
            </p>
            {failed && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-pearl px-4 py-2">
                    <p id={messageId} className="text-body-sm text-slate">
                        {labels.failed}
                    </p>
                    <button
                        type="button"
                        {...busyControlProps({ busy: refreshing, onClick: onRetry })}
                        aria-describedby={messageId}
                        className={`inline-flex min-h-11 items-center justify-center rounded-full border border-mist bg-sand px-4 py-2 text-body-sm font-semibold text-charcoal transition hover:bg-mist/40 md:min-h-0 ${BUSY_CONTROL_CLASS}`}
                    >
                        {labels.retry}
                    </button>
                </div>
            )}
        </>
    );
};
