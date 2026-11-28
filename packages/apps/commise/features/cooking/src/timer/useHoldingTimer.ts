'use client';

/**
 * @module useHoldingTimer — the timer that keeps the screen on: the first one that counts down or rings.
 */
import type { ActiveTimer } from '@kitchensink/cooking-core';

import { useCookingTimers } from './useCookingTimers.js';

/**
 * The first timer that counts down or rings. A paused timer, and one that ended while the cook was away, hold nothing.
 *
 * @returns The timer, or `undefined` when none holds the screen.
 * @throws {Error} When no `TimerProvider` is above.
 */
export function useHoldingTimer(): ActiveTimer | undefined {
    const { order } = useCookingTimers();

    return order.flatMap((entry) =>
        entry.kind === 'live' && (entry.timer.kind === 'running' || entry.timer.kind === 'ringing')
            ? [entry.timer]
            : [],
    )[0];
}
