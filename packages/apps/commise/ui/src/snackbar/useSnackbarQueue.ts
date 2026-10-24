/**
 * @module @commise/ui/snackbar — `useSnackbarQueue`: the runtime both host leaves share around the pure queue
 * (`snackbarQueue.ts`) — the reducer, the one timer for the snackbar on screen, and running each committed snackbar's
 * `onTimeout` exactly once. The leaves own only where the snackbar is drawn and what pauses it.
 *
 * The clock is read here, in handlers and effects, never in the reducer.
 */
import { useCallback, useEffect, useReducer } from 'react';

import type { SnackbarAction, SnackbarInput } from './props.js';
import { INITIAL_SNACKBAR_STATE, msUntilExpiry, snackbarReducer, type SnackbarEntry } from './snackbarQueue.js';

/** What a host leaf drives the queue with. */
export interface SnackbarQueue {
    /** The snackbar on screen, if any. */
    readonly current: SnackbarEntry | null;
    readonly show: (input: SnackbarInput) => void;
    /** Take the current snackbar's action: it closes without committing. */
    readonly act: (id: number, action: SnackbarAction) => void;
    readonly pause: (id: number) => void;
    readonly resume: (id: number) => void;
}

/**
 * The snackbar queue's runtime.
 *
 * @returns The current snackbar and the handlers a host leaf wires to it.
 * @sideEffect Runs a timer for the snackbar on screen, and each committed snackbar's `onTimeout` once.
 */
export function useSnackbarQueue(): SnackbarQueue {
    const [state, dispatch] = useReducer(snackbarReducer, INITIAL_SNACKBAR_STATE);
    const { current, settled } = state;

    // Commit what the queue has settled — a snackbar that timed out or that a newer one replaced — once each.
    useEffect(() => {
        if (settled.length === 0) {
            return;
        }

        for (const entry of settled) {
            entry.input.onTimeout?.();
        }

        dispatch({ type: 'drained', ids: settled.map((entry) => entry.id) });
    }, [settled]);

    // One timer, for the snackbar on screen while it runs; a pause or a newer snackbar clears it.
    useEffect(() => {
        const wait = msUntilExpiry(current, Date.now());

        if (current === null || wait === null) {
            return undefined;
        }

        const timer = setTimeout(() => dispatch({ type: 'expire', id: current.id }), wait);

        return () => clearTimeout(timer);
    }, [current]);

    // Stable across renders (`dispatch` is), so a leaf can name them as effect dependencies.
    const show = useCallback((input: SnackbarInput) => dispatch({ type: 'show', input, now: Date.now() }), []);
    const act = useCallback((id: number, action: SnackbarAction) => {
        dispatch({ type: 'act', id });
        action.onAction();
    }, []);
    const pause = useCallback((id: number) => dispatch({ type: 'pause', id, now: Date.now() }), []);
    const resume = useCallback((id: number) => dispatch({ type: 'resume', id, now: Date.now() }), []);

    return { current, show, act, pause, resume };
}
