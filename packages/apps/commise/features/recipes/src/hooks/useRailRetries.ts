/**
 * @module @commise/features-recipes/hooks — how many times each browse rail's own Try again was pressed. The rail's
 * heading takes focus when its count moves, because the pressed button unmounts as the rail reloads. One hook for the web
 * container and the mobile screen.
 */
import { useState } from 'react';

import type { RecipeBrowseRailId } from '../discovery/model.js';

/** The count per rail. */
export type RailRetries = Readonly<Record<RecipeBrowseRailId, number>>;

/** No rail has been retried yet. */
const NO_RAIL_RETRIES: RailRetries = { trending: 0, new: 0, quick: 0 };

/**
 * The per-rail Try again counters.
 *
 * @returns The counts, and `retry` — count one press of `rail`'s Try again.
 * @sideEffect `retry` updates component state.
 */
export function useRailRetries(): {
    readonly retries: RailRetries;
    readonly retry: (rail: RecipeBrowseRailId) => void;
} {
    const [retries, setRetries] = useState<RailRetries>(NO_RAIL_RETRIES);

    return {
        retries,
        retry: (rail) => {
            setRetries((current) => ({ ...current, [rail]: current[rail] + 1 }));
        },
    };
}
