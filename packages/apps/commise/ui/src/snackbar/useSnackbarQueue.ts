/**
 * @module @commise/ui/snackbar — `useSnackbarQueue`: the runtime both host leaves share around the pure queue
 * (`snackbarQueue.ts`) — the reducer, the one timer for the snackbar on screen, and running each committed snackbar's
 * `onTimeout` exactly once. The leaves own only where the snackbar is drawn and what pauses it.
 *
 * The queue lives in an external store (`snackbarStore.ts`) so `withdraw` can answer in the handler that asks. Every
 * handler reads the store's clock; this hook reads `Date.now` only to arm the expiry timer, and the reducer never
 * reads a clock.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { SnackbarAction, SnackbarApi } from './props.js';
import { msUntilExpiry, type SnackbarEntry } from './snackbarQueue.js';
import { createSnackbarStore } from './snackbarStore.js';

/** What a host leaf drives the queue with. */
export interface SnackbarQueue {
    /** The snackbar on screen, if any. */
    readonly current: SnackbarEntry | null;
    readonly show: SnackbarApi['show'];
    readonly withdraw: SnackbarApi['withdraw'];
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
    const [store] = useState(() => createSnackbarStore(Date.now));
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const { dispatch } = store;
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
    }, [settled, dispatch]);

    // One timer, for the snackbar on screen while it runs; a pause or a newer snackbar clears it.
    useEffect(() => {
        const wait = msUntilExpiry(current, Date.now());

        if (current === null || wait === null) {
            return undefined;
        }

        const timer = setTimeout(() => dispatch({ type: 'expire', id: current.id }), wait);

        return () => clearTimeout(timer);
    }, [current, dispatch]);

    return {
        current,
        show: store.show,
        withdraw: store.withdraw,
        act: store.act,
        pause: store.pause,
        resume: store.resume,
    };
}
