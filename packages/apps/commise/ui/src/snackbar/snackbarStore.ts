/**
 * @module @commise/ui/snackbar — the snackbar queue's store: the pure reducer's state, applied synchronously, with
 * subscribers.
 *
 * It is external to React because `withdraw` must answer in the handler that asks. A reducer held in a component
 * reads only the last render, so a `show` dispatched earlier in the same handler would not be seen, and a withdraw
 * could return the time of a snackbar that is about to commit.
 *
 * @pattern Observer — a store over the pure reducer (State + Command), read by `useSnackbarQueue` through
 *     `useSyncExternalStore`
 */
import type { SnackbarAction, SnackbarHandle, SnackbarInput } from './props.js';
import {
    INITIAL_SNACKBAR_STATE,
    remainingMsOf,
    snackbarReducer,
    type SnackbarQueueAction,
    type SnackbarState,
} from './snackbarQueue.js';

/** The queue's store. */
export interface SnackbarStore {
    readonly getState: () => SnackbarState;
    readonly subscribe: (listener: () => void) => () => void;
    readonly dispatch: (action: SnackbarQueueAction) => void;
    /** Shows a snackbar and returns its handle. */
    readonly show: (input: SnackbarInput) => SnackbarHandle;
    /** The remaining ms and a close without commit, only for the snackbar showing now. */
    readonly withdraw: (handle: SnackbarHandle) => number | undefined;
    /** Takes the snackbar's action: it closes without committing, then the action runs. */
    readonly act: (id: number, action: SnackbarAction) => void;
    readonly pause: (id: number) => void;
    readonly resume: (id: number) => void;
    /**
     * Tells the store whom the snackbars belong to: a user id, `null` once signed out, or `undefined` while it is not
     * yet known. `undefined` changes nothing. A change from a subject the store holds closes the snackbar showing
     * without its action and without its commit, because a snackbar that names a recipe must never show to the next
     * person at the screen. Snackbars that had already committed still run their `onTimeout`.
     */
    readonly observeSubject: (next: SnackbarSubject) => void;
}

/** Whom the snackbars belong to: a user id, `null` when signed out, `undefined` while unknown. */
type SnackbarSubject = string | null | undefined;

/**
 * A store for one queue.
 *
 * @param now - The clock, read when a snackbar is shown, withdrawn, paused or resumed.
 * @returns The store.
 * @sideEffect Holds the queue's state and notifies its subscribers.
 */
export function createSnackbarStore(now: () => number): SnackbarStore {
    let state = INITIAL_SNACKBAR_STATE;
    let subject: SnackbarSubject;
    const listeners = new Set<() => void>();

    const dispatch = (action: SnackbarQueueAction): void => {
        const next = snackbarReducer(state, action);

        if (next === state) {
            return;
        }

        state = next;
        listeners.forEach((listener) => {
            listener();
        });
    };

    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        dispatch,
        show: (input) => {
            const handle: SnackbarHandle = { snackbar: true };

            dispatch({ type: 'show', input, handle, now: now() });

            return handle;
        },
        withdraw: (handle) => {
            const { current } = state;

            if (current === null || current.handle !== handle) {
                return undefined;
            }

            const remaining = remainingMsOf(current, now());

            dispatch({ type: 'act', id: current.id });

            return remaining;
        },
        act: (id, action) => {
            dispatch({ type: 'act', id });
            action.onAction();
        },
        pause: (id) => {
            dispatch({ type: 'pause', id, now: now() });
        },
        resume: (id) => {
            dispatch({ type: 'resume', id, now: now() });
        },
        observeSubject: (next) => {
            if (next === undefined) {
                return;
            }

            const { current } = state;

            if (subject !== undefined && subject !== next && current !== null) {
                dispatch({ type: 'act', id: current.id });
            }

            subject = next;
        },
    };
}
