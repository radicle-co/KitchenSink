'use client';

/**
 * @module useSecondTick — the clock, moved on once a second while something counts down.
 *
 * The countdown on the dock row is drawn from the timer's end and this clock, so the figure is always right however
 * late a tick comes. A paused timer, a ringing one or no timer needs no tick, so the interval runs only while `active`.
 *
 * @pattern Observer — a timer subscription that re-renders its reader once a second
 */
import { useEffect, useState } from 'react';

/** How often the clock moves on, in ms. */
const TICK_MS = 1000;

/**
 * The clock now, in ms, refreshed once a second while `active`.
 *
 * @param active - Whether anything counts down. When it turns on the clock is read again at once.
 * @returns `Date.now()` as of the last tick.
 * @sideEffect Runs an interval while `active`, and clears it when `active` turns off or the component unmounts.
 */
export function useSecondTick(active: boolean): number {
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (!active) {
            return undefined;
        }

        setNowMs(Date.now());
        const interval = setInterval(() => {
            setNowMs(Date.now());
        }, TICK_MS);

        return () => {
            clearInterval(interval);
        };
    }, [active]);

    return nowMs;
}
