'use client';

import { useEffect, useState } from 'react';

/** What the loading screen shows: nothing, the skeleton, the skeleton with its label, or the slow-load actions. */
export type LoadingPhase = 'blank' | 'skeleton' | 'label' | 'slow';

/** When each phase begins, in milliseconds since the read started. The ONE place the numbers are written. */
export const LOADING_PHASE_EDGES = { skeleton: 300, label: 1000, slow: 10_000 } as const;

/**
 * The phase for a read that has been in flight for `elapsedMs`. Nothing at all for a quick read, so a fast load never
 * flashes a skeleton.
 *
 * @param elapsedMs - Milliseconds since the read started.
 * @returns The phase; `blank` for a time it cannot trust. Pure.
 */
export function loadingPhase(elapsedMs: number): LoadingPhase {
    if (!Number.isFinite(elapsedMs) || elapsedMs < LOADING_PHASE_EDGES.skeleton) {
        return 'blank';
    }

    if (elapsedMs < LOADING_PHASE_EDGES.label) {
        return 'skeleton';
    }

    return elapsedMs < LOADING_PHASE_EDGES.slow ? 'label' : 'slow';
}

/**
 * The loading phase as time passes while a read is in flight.
 *
 * @pattern Headless hook — a clock over the pure {@link loadingPhase} rule
 * @param active - Whether a read is in flight. Going false and true again starts over.
 * @returns The current phase; `blank` while nothing is loading.
 * @sideEffect Sets three timers while `active`, and clears them when it stops or the screen goes away.
 */
export function useLoadingPhase(active: boolean): LoadingPhase {
    const [elapsedMs, setElapsedMs] = useState(0);

    useEffect(() => {
        if (!active) {
            return undefined;
        }

        const timers = Object.values(LOADING_PHASE_EDGES).map((edge) => setTimeout(() => setElapsedMs(edge), edge));

        return () => {
            timers.forEach(clearTimeout);
            setElapsedMs(0);
        };
    }, [active]);

    return active ? loadingPhase(elapsedMs) : 'blank';
}
