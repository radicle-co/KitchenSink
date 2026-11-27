/**
 * @module useTimerStore — the session's one timer store, read from context. The single place that says what a missing
 * `TimerProvider` means, so every reader fails the same way.
 */
import { useContext } from 'react';

import { TimerStoreContext } from './timerContext.js';
import type { TimerStore } from './timerStore.js';

/**
 * The timer store of the session.
 *
 * @returns The store.
 * @throws {Error} When no `TimerProvider` is above.
 */
export function useTimerStore(): TimerStore {
    const store = useContext(TimerStoreContext);

    if (store === null) {
        throw new Error('The timer hooks need a TimerProvider above them.');
    }

    return store;
}
