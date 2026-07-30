/**
 * Headless poll-after-add for one food-backed ingredient line (mobile, data-model R5 / FR-007). When the
 * editor adds a line that came back `PENDING` (nutrition still resolving), it renders ONE of these per pending
 * line: it drives `useIngredientStatus` (self-limiting — it refetches only while the food is `PENDING` and
 * stops the instant a terminal/`RESOLVED`/`UNRESOLVED` state arrives) and reports every observed status back
 * up via `onStatus`, so the editor can flip the line's badge from `PENDING` to `RESOLVED` (or surface
 * `UNRESOLVED` / a terminal state).
 *
 * It renders nothing — the visible status lives on the shared form's per-line badge. The editor makes
 * `onStatus` idempotent (via `setIngredientStatusById`, which no-ops an unchanged status) so the repeated
 * callback cannot loop, and unmounts this poller once the line leaves `PENDING` (which also stops the query).
 */
import { usePollIngredientStatus } from '@commise/features-recipes/hooks';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';

/** Props for {@link IngredientStatusPoller}. */
export interface IngredientStatusPollerProps {
    /** The catalog ingredient id of the pending line to poll. */
    readonly ingredientId: string;
    /** Called with the latest observed resolution status whenever it is known. Must be idempotent. */
    readonly onStatus: (ingredientId: string, status: FoodResolutionStatus) => void;
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
