'use client';

/**
 * @module useSecondTick — the clock, moved on once a second while something counts down.
 *
 * The countdown on the dock row is drawn from the timer's end and this clock, so the figure is always right however
 * late a tick comes. A paused timer, a ringing one or no timer needs no tick, so the interval runs only while `active`.
 *
 * @pattern Observer — an external clock that `useSyncExternalStore` reads, so its reader re-renders once a second
 */
import { useCallback, useState, useSyncExternalStore } from 'react';

/** How often the clock moves on, in ms. */
const TICK_MS = 1000;

/** A clock that holds the time of its last refresh, so a read between ticks answers the same value. */
function createClock(): { readonly read: () => number; readonly refresh: () => void } {
    let nowMs = Date.now();

    return {
        read: () => nowMs,
        refresh: () => {
            nowMs = Date.now();
        },
    };
}

/**
 * The clock now, in ms, refreshed once a second while `active`.
 *
 * @param active - Whether anything counts down. When it turns on the clock is read again at once.
 * @returns `Date.now()` as of the last tick.
 * @sideEffect Runs an interval while `active`, and clears it when `active` turns off or the component unmounts.
 */
export function useSecondTick(active: boolean): number {
    const [clock] = useState(createClock);
    const subscribe = useCallback(
        (notify: () => void) => {
            if (!active) {
                return () => undefined;
            }

            const refresh = (): void => {
                clock.refresh();
                notify();
            };

            refresh();
            const interval = setInterval(refresh, TICK_MS);

            return () => {
                clearInterval(interval);
            };
        },
        [active, clock],
    );

    return useSyncExternalStore(subscribe, clock.read, clock.read);
}
