/**
 * @module @commise/ui/refresh-notice — the web notice for a failed refresh of data that stays on screen.
 *
 * While nothing has failed it renders only a `status` region, mounted EMPTY, so a failure announces when its text
 * appears. On failure the region says what happened and a visible row shows the same message with a Try again
 * button. The rows the viewer is reading are still valid, so the region is POLITE — unlike `LoadMoreControl`'s
 * assertive alert, which reports an action the viewer just took failing.
 *
 * A retry in flight keeps the message and the SAME button (busy through `Button`, i.e. `busyControlProps`): unmounting the pressed
 * button would drop its focus to `<body>` (WCAG 2.2 SC 2.4.3). Only the announcement clears, so a second failure is
 * announced again. A successful refresh removes the row; where focus goes then is the surface's decision, because
 * only the surface knows what it would land on.
 *
 * The button is the quiet `Button` with the retry glyph. It used to carry a `lineDivider` hairline and a `canvas` fill so
 * a text-only control on a `surfaceMuted` row read as pressable; the `actionText` glyph is that cue now, and the tonal
 * fill is a chip's (`componentFixes.md` §4), so the control draws none. The row IS `surfaceMuted`, so the button says
 * `over="muted"` and presses to `lineDivider`: a `surfaceMuted` press would be the row's own colour and show nothing.
 *
 * A presentational leaf: the caller derives `failed` and `refreshing` from its query.
 *
 * @pattern Facade over the design system's quiet `Button` and a polite `status` region, with the busy half and the
 *     failure reason's description delegated to `Button`
 */
import type { FC } from 'react';

import { Button } from '../button/Button.js';
import type { RefreshNoticeProps } from './props.js';

/** The failed-refresh notice: a silent region until a refresh fails, then the message and its retry. */
export const RefreshNotice: FC<RefreshNoticeProps> = ({ failed, refreshing, onRetry, labels }) => {
    return (
        <>
            <p role="status" className="sr-only">
                {failed && !refreshing ? labels.failed : ''}
            </p>
            {failed && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-4 py-2">
                    <p className="text-body-sm text-ink-muted">{labels.failed}</p>
                    <Button
                        variant="quiet"
                        over="muted"
                        icon="refreshCw"
                        busy={refreshing}
                        onPress={onRetry}
                        description={labels.failed}
                    >
                        {labels.retry}
                    </Button>
                </div>
            )}
        </>
    );
};
