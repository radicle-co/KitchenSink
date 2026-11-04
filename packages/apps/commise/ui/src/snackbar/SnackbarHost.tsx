'use client';

/**
 * @module @commise/ui/snackbar — the web {@link SnackbarHost}: mounted once per app (in `AppShell`), it gives screens
 * `useSnackbar` and draws the one snackbar on screen.
 *
 * The status region is ALWAYS mounted, empty at rest, so a message dropped into it is announced (a live region added
 * with its content is not reliably spoken). It is polite and never takes focus. It sits 16 px above the page's bottom
 * chrome, read from the page's `PopupInsetsContext` reader as each snackbar shows, and is centred at the foot. The
 * pointer or focus inside the snackbar pauses its timer (SC 2.2.1).
 *
 * It also publishes the showing snackbar's measured height (`SnackbarClearanceContext`), so the floating create button
 * rises above the bar, which is full width below `nav`, instead of sitting under it.
 *
 * `'use client'`: the queue is state and its timer an effect.
 *
 * The orchestration half for the snackbar: it owns the queue and its timer, and the leaf it draws only renders.
 *
 * @pattern Mediator — the host stands between the screens that ask and the one snackbar that shows; the queue's rules
 *     are the pure reducer's (State + Command)
 */
import { useContext, useState, type FC } from 'react';

import { useRenderedHeight } from '../layout/useRenderedHeight.js';
import { PopupInsetsContext } from '../popupInsets/popupInsetsContext.js';
import { SNACKBAR_GAP, type SnackbarHostProps } from './props.js';
import { SnackbarClearanceContext } from './snackbarClearanceContext.js';
import { SnackbarContext } from './snackbarContext.js';
import { UndoSnackbar } from './UndoSnackbar.js';
import { useSnackbarQueue } from './useSnackbarQueue.js';

/** The web snackbar host. */
export const SnackbarHost: FC<SnackbarHostProps> = ({ children }) => {
    const queue = useSnackbarQueue();
    const readInsets = useContext(PopupInsetsContext);
    const [bottom, setBottom] = useState(SNACKBAR_GAP);
    const { current } = queue;
    const action = current?.input.action;
    const [region, setRegion] = useState<HTMLElement | null>(null);
    const regionHeight = useRenderedHeight(region, 0);

    return (
        <SnackbarContext
            value={{
                show: (input) => {
                    setBottom(readInsets().bottom + SNACKBAR_GAP);
                    queue.show(input);
                },
            }}
        >
            {/* The measured height, or 0 when nothing shows, so the floating create button can rise above the bar. */}
            <SnackbarClearanceContext value={current === null ? 0 : regionHeight}>{children}</SnackbarClearanceContext>
            <div
                ref={setRegion}
                role="status"
                className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
                style={{ bottom }}
            >
                {current === null ? null : (
                    <UndoSnackbar
                        key={current.id}
                        message={current.input.message}
                        {...(action === undefined
                            ? {}
                            : { action: { label: action.label, onAction: () => queue.act(current.id, action) } })}
                        onPause={() => queue.pause(current.id)}
                        onResume={() => queue.resume(current.id)}
                    />
                )}
            </div>
        </SnackbarContext>
    );
};
