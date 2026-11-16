'use client';

import { useEffect, useState } from 'react';

/** How long Done ignores a press after it appears, in milliseconds. The ONE place the number is written (S24, D15). */
export const DONE_SETTLE_MS = 400;

/**
 * Whether Done may take a press. The tap that finishes the last step must not also choose "Cook it again" or "Back to
 * the recipe", so Done waits {@link DONE_SETTLE_MS} after it appears. A step never waits.
 *
 * @pattern Headless hook — a timer over a flag, the same shape as `useLoadingPhase`
 * @param finished - Whether the cook is on Done. Going false and true again starts the wait over.
 * @returns `true` when presses count: always while not finished, and after the wait once finished.
 * @sideEffect Sets one timer while `finished`, and clears it when it stops or the screen goes away.
 */
export function useDoneSettled(finished: boolean): boolean {
    const [wait, setWait] = useState({ finished, settled: !finished });

    // Done that begins again starts from unsettled on the render it begins, not after an effect.
    if (wait.finished !== finished) {
        setWait({ finished, settled: !finished });
    }

    useEffect(() => {
        if (!finished) {
            return undefined;
        }

        const timer = setTimeout(() => setWait({ finished: true, settled: true }), DONE_SETTLE_MS);

        return () => clearTimeout(timer);
    }, [finished]);

    return wait.settled;
}
