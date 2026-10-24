/**
 * @module @commise/query/recovery-signal — a recovery count held on the near side of a suspense boundary.
 *
 * A surface whose focus target (a heading in a frame outside the boundary) and whose failed-refresh notice (inside it)
 * sit on opposite sides cannot share the notice's own `recoveries` counter. The notice reports each successful retry
 * through `useRefreshNotice`'s `onRecovered`, and this counts them where the heading is; a change is the signal to move
 * focus there.
 */
import { useReducer } from 'react';

/** A recovery count held where a surface's focus target is, fed by a notice's `onRecovered`. */
export interface RecoverySignal {
    /** How many recoveries have been reported; a change is the signal to move focus. */
    readonly signal: number;
    /** Report one recovery. Its identity never changes. */
    readonly onRecovered: () => void;
}

/**
 * Hold a recovery count on the near side of a suspense boundary, for a notice on the far side to advance.
 *
 * @returns The count and the stable callback that advances it.
 */
export function useRecoverySignal(): RecoverySignal {
    const [signal, onRecovered] = useReducer((count: number) => count + 1, 0);

    return { signal, onRecovered };
}
