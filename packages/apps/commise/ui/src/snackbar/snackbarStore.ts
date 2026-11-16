/**
 * @module @commise/ui/snackbar — the snackbar queue's store: the pure reducer's state, applied synchronously, with
 * subscribers.
 *
 * It is external to React because `withdraw` must answer in the handler that asks. A reducer held in a component
 * reads only the last render, so a `show` dispatched earlier in the same handler would not be seen, and a withdraw
 * could return the time of a snackbar that is about to commit (S37).
 *
 * @pattern Observer — a store over the pure reducer (State + Command), read by `useSnackbarQueue` through
 *     `useSyncExternalStore`
 */
import type { SnackbarHandle, SnackbarInput } from './props.js';
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
    /** S37: the remaining ms and a close without commit, only for the snackbar showing now. */
    readonly withdraw: (handle: SnackbarHandle) => number | undefined;
}

/**
 * A store for one queue.
 *
 * @param now - The clock, read when a snackbar is shown or withdrawn.
 * @returns The store.
 * @sideEffect Holds the queue's state and notifies its subscribers.
 */
export function createSnackbarStore(now: () => number): SnackbarStore {
    let state = INITIAL_SNACKBAR_STATE;
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
    };
}
