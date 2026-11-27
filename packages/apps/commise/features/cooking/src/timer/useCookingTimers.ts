'use client';

/**
 * @module useCookingTimers — the timer list for a screen: what to draw, and how to start and change a timer.
 */
import {
    NO_TIMER,
    alarmQueue,
    timerOrder,
    type RingingTimer,
    type TimerOrderEntry,
    type TimerState,
} from '@kitchensink/cooking-core';
import { useMemo, useSyncExternalStore } from 'react';

import type { TimerStore } from './timerStore.js';
import { useTimerStore } from './useTimerStore.js';

/** What a screen reads and calls. */
export interface CookingTimers {
    /** The list in the order the cook sees it, with the held Undo slot. */
    readonly order: readonly TimerOrderEntry[];
    /** The id of the held Undo timer, or `undefined`. */
    readonly undoId: string | undefined;
    /** Ringing timers, in the order their alarms sound. */
    readonly alarmQueue: readonly RingingTimer[];
    readonly start: TimerStore['start'];
    readonly command: TimerStore['command'];
}

/** The server renders no timers: they live on the device. */
const serverSnapshot = (): TimerState => NO_TIMER;

/**
 * The session's timers.
 *
 * @returns The list, the held Undo, the alarm queue and the two ways to change them. It changes only when the state does.
 * @throws {Error} When no `TimerProvider` is above.
 */
export function useCookingTimers(): CookingTimers {
    const store = useTimerStore();

    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);

    return useMemo(
        () => ({
            order: timerOrder(state),
            undoId: state.undo?.id,
            alarmQueue: alarmQueue(state),
            start: store.start,
            command: store.command,
        }),
        [state, store],
    );
}
