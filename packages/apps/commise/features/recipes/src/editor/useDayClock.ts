/**
 * The instant a day-worded notice is read at, read again just after each device midnight.
 *
 * A notice that says "tomorrow" changes only when the day does, and nothing re-renders the editor then. A render-time
 * `new Date()` would keep yesterday's word on a notice left open overnight, so the clock is read once, held, and read
 * again by a timer armed for the next midnight (the house pattern of `usePasteIntoIngredients`' deadline clock).
 *
 * @module
 */
import { useEffect, useState } from 'react';

/** The device clock: module-level, so a caller without its own clock does not re-arm the timer on every render. */
export const systemNow = (): Date => new Date();

/**
 * Hold the clock's instant, refreshed past each device midnight.
 *
 * @param now - The clock. Injected so a test can move time.
 * @returns The held instant, ISO 8601.
 * @sideEffect Arms a timer that reads the clock again just after the next device midnight.
 */
export function useDayClock(now: () => Date): string {
    const [stamp, setStamp] = useState(() => now().toISOString());

    useEffect(() => {
        const midnight = new Date(stamp);

        midnight.setHours(24, 0, 0, 0);

        const timer = setTimeout(
            () => setStamp(now().toISOString()),
            Math.max(0, midnight.getTime() - now().getTime()) + 1,
        );

        return () => clearTimeout(timer);
    }, [stamp, now]);

    return stamp;
}
