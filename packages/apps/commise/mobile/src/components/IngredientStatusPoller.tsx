/**
 * Headless poll-after-add for one food-backed ingredient line (mobile, data-model R5 / FR-007). When the
 * editor adds a line that came back `PENDING` (nutrition still resolving), it renders ONE of these per pending
 * line: it drives `useIngredientStatus` (self-limiting — it refetches only while the food is `PENDING` and
 * stops the instant a terminal/`RESOLVED`/`UNRESOLVED` state arrives) and reports every observed status back
 * up via `onStatus`, so the editor can flip the line's badge from `PENDING` to `RESOLVED` (or surface
 * `UNRESOLVED` / a terminal state).
 *
 * It renders nothing — the visible status lives on the shared form's per-line badge. The editor makes
 * `onStatus` idempotent (via `settleIngredientLine`, which no-ops an unchanged answer) so the repeated
 * callback cannot loop, and unmounts this poller once the line leaves `PENDING` (which also stops the query).
 */
import type { ObservedIngredientStatus } from '@commise/features-recipes';
import { usePollIngredientStatus } from '@commise/features-recipes/hooks';

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
export function IngredientStatusPoller({ ingredientId, onStatus }: IngredientStatusPollerProps): null {
    usePollIngredientStatus(ingredientId, onStatus);

    return null;
}
