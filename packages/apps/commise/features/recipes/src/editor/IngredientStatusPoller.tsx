'use client';

/**
 * Headless poll-after-add for one food-backed ingredient line (data-model R5 / FR-007), for both apps. When the picker
 * adds a line that came back `PENDING` (nutrition still resolving), the editor renders ONE of these per pending line:
 * it drives `useIngredientStatus` (which self-limits — it refetches only while the food is `PENDING` and stops the
 * instant a terminal/`RESOLVED`/`UNRESOLVED` state arrives) and reports every observed status back up via `onStatus`,
 * so the editor can flip the line's badge from `PENDING` to `RESOLVED` (or surface `UNRESOLVED` for disambiguation, or
 * a terminal state).
 *
 * It renders nothing — the visible status lives on the form's own per-line badge. The editor makes `onStatus`
 * idempotent (`settleIngredientLine` no-ops an unchanged answer) so the repeated callback cannot loop, and unmounts this
 * poller once the line leaves `PENDING` (which also stops the query).
 */
import type { FC } from 'react';

import { usePollIngredientStatus } from '../hooks/usePollIngredientStatus.js';
import type { ObservedIngredientStatus } from '../form/ingredientStatus.js';

/** Props for {@link IngredientStatusPoller}. */
export interface IngredientStatusPollerProps {
    /** The binding of the pending line to poll. */
    readonly ingredientId: string;
    /**
     * Called with the polled id and what the poll observed — the binding the server answered with (a different id once
     * the line settled, plan 002) and its status. Must be idempotent.
     */
    readonly onStatus: (polledId: string, observed: ObservedIngredientStatus) => void;
}

/**
 * Poll one pending food-backed line to resolution.
 *
 * @param props - The line's ingredient id + the status-report callback.
 * @returns Nothing (headless) — the line's badge is rendered by the form.
 */
export const IngredientStatusPoller: FC<IngredientStatusPollerProps> = ({ ingredientId, onStatus }) => {
    usePollIngredientStatus(ingredientId, onStatus);

    return null;
};
