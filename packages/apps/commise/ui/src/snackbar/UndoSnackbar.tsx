/**
 * @module @commise/ui/snackbar — the web {@link UndoSnackbar}: what the host draws for the snackbar on screen (spec
 * §1.11).
 *
 * `inverse` with an `inverseInk` message (12.68:1) that always wraps by words and is never clamped or cut, and its
 * action in `inverseAction` (4.56:1 on `inverse`) at a 44 px target that never wraps. All three are roles, so the bar
 * inverts in either theme. The row wraps: the message asks for room (`snackbarMessageBasis`, which grows with the text
 * size), so when it has no room beside the action the action drops to its own row under it, at the end. The message may
 * shrink here because CSS breaks the line on its basis; the native twin may not, because Yoga would squeeze it. At most
 * 36 rem wide. It rises 8 px
 * into place over 200 ms only when motion is allowed, and otherwise fades. The pointer or focus inside it tells the
 * host to pause its timer.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Command (invoker) — its action is the `{ label, onAction }` command the queue carries; pressing it invokes
 *     that command and nothing else.
 */
import type { FC } from 'react';

import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';
import type { UndoSnackbarProps } from './props.js';
import { PRESS_FILL_CLASS, surfaceToneClass } from '../surfaceTone/surfaceToneClass.js';

/** The bar's box, in pieces so no line runs past 120 characters. */
const BAR_CLASS = [
    'pointer-events-auto flex w-full max-w-[36rem] flex-wrap items-center gap-x-3 rounded-md',
    surfaceToneClass('inverse'),
    'px-4 py-2 shadow-lg transition duration-200 starting:opacity-0 motion-safe:starting:translate-y-2',
].join(' ');

/** The action's box: at the end of its row, so under a wrapped message it sits at the end. */
const ACTION_CLASS = [
    'ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2',
    'text-label text-inverse-action',
    PRESS_FILL_CLASS.pointer,
    FOCUS_RING_CLASS.inverse,
].join(' ');

/** The web snackbar. */
export const UndoSnackbar: FC<UndoSnackbarProps> = ({ message, action, onPause, onResume }) => (
    <div onPointerEnter={onPause} onPointerLeave={onResume} onFocus={onPause} onBlur={onResume} className={BAR_CLASS}>
        <p className="min-w-0 flex-[1_1_var(--snackbar-message-basis)] break-words py-1 text-body text-inverse-ink">
            {message}
        </p>
        {action === undefined ? null : (
            <button type="button" onClick={action.onAction} className={ACTION_CLASS}>
                {action.label}
            </button>
        )}
    </div>
);
