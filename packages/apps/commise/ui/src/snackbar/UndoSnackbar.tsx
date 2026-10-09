/**
 * @module @commise/ui/snackbar — the web {@link UndoSnackbar}: what the host draws for the snackbar on screen (spec
 * §1.11).
 *
 * `inverse` with an `inverseInk` message (12.68:1) that wraps to two lines at most, and its action in `inverseAction`
 * (4.56:1 on `inverse`) at a 44 px target that never wraps. All three are roles, so the bar inverts in either theme. At
 * most 36 rem wide. It rises 8 px into place over 200 ms only when motion is allowed, and otherwise fades. The pointer or focus inside it tells the host to pause its timer.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Command (invoker) — its action is the `{ label, onAction }` command the queue carries; pressing it invokes
 *     that command and nothing else.
 */
import type { FC } from 'react';

import type { UndoSnackbarProps } from './props.js';

/** The web snackbar. */
export const UndoSnackbar: FC<UndoSnackbarProps> = ({ message, action, onPause, onResume }) => (
    <div
        onPointerEnter={onPause}
        onPointerLeave={onResume}
        onFocus={onPause}
        onBlur={onResume}
        className="pointer-events-auto flex w-full max-w-[36rem] items-center gap-3 rounded-md bg-inverse px-4 py-2 shadow-lg transition duration-200 starting:opacity-0 motion-safe:starting:translate-y-2"
    >
        <p className="line-clamp-2 min-w-0 flex-1 py-1 text-body text-inverse-ink">{message}</p>
        {action === undefined ? null : (
            <button
                type="button"
                onClick={action.onAction}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 text-label text-inverse-action hover:bg-inverse-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-action"
            >
                {action.label}
            </button>
        )}
    </div>
);
