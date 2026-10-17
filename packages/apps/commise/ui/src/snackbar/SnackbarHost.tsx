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
 * `'use client'`: the queue is state and its timer an effect.
 *
 * The orchestration half for the snackbar: it owns the queue and its timer, and the leaf it draws only renders.
 *
 * @pattern Mediator — the host stands between the screens that ask and the one snackbar that shows; the queue's rules
 *     are the pure reducer's (State + Command)
 */
import { useContext, useState, type FC } from 'react';

import { PopupInsetsContext } from '../popupInsets/popupInsetsContext.js';
import { SNACKBAR_GAP, type SnackbarHostProps } from './props.js';
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

    return (
        <SnackbarContext
            value={{
                show: (input) => {
                    setBottom(readInsets().bottom + SNACKBAR_GAP);
                    queue.show(input);
                },
            }}
        >
            {children}
            <div
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
