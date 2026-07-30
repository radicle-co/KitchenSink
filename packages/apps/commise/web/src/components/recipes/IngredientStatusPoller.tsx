'use client';

/**
 * Headless poll-after-add for one food-backed ingredient line (data-model R5 / FR-007). When the picker adds
 * a line that came back `PENDING` (nutrition still resolving), the composing create/edit container renders
 * ONE of these per pending line: it drives `useIngredientStatus` (which self-limits — it refetches only while
 * the food is `PENDING` and stops the instant a terminal/`RESOLVED`/`UNRESOLVED` state arrives) and reports
 * every observed status back up via `onStatus`, so the container can flip the line's badge from `PENDING` to
 * `RESOLVED` (or surface `UNRESOLVED` for disambiguation, or a terminal state).
 *
 * It renders nothing — the visible status lives on the form's own per-line badge. The container is
 * responsible for making `onStatus` idempotent (only patch the line when the status actually changed) so the
 * repeated callback fires cannot loop, and for unmounting this poller once the line is no longer `PENDING`
 * (which also stops the query).
 */
import { usePollIngredientStatus } from '@commise/features-recipes/hooks';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { FC } from 'react';

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
export const IngredientStatusPoller: FC<IngredientStatusPollerProps> = ({ ingredientId, onStatus }) => {
    usePollIngredientStatus(ingredientId, onStatus);

    return null;
};
