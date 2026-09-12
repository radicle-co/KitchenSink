/**
 * Headless-hook seam (CP-6/B4) — the shared poll-after-add logic for one food-backed ingredient line
 * (data-model R5 / FR-007), extracted from the two byte-for-byte-identical `IngredientStatusPoller`
 * components (web `web/src/components/recipes/IngredientStatusPoller.tsx`, mobile
 * `mobile/src/components/IngredientStatusPoller.tsx`). Both leaves reduce to this hook + `return null`.
 *
 * Platform-agnostic: no DOM/React Native imports, so a non-React consumer of this package's pure models
 * never pulls it in (it lives under the `./hooks` export subpath, not the root barrel).
 *
 * Drives `useIngredientStatus` (which self-limits — it refetches only while the food is `PENDING` and
 * stops the instant a terminal/`RESOLVED`/`UNRESOLVED` state arrives; see
 * `packages/clients/recipe-service/src/hooks.ts`) and reports every observed status back up via
 * `onStatus`, so the caller can flip the line's badge from `PENDING` to `RESOLVED` (or surface
 * `UNRESOLVED` for disambiguation, or a terminal state).
 *
 * This hook renders nothing (it has no render output at all) and does not itself loop or interval —
 * the self-limiting poll cadence is entirely owned by `useIngredientStatus`.
 */
import { useIngredientStatus } from '@kitchensink/recipe-service-client/hooks';
import { useEffect } from 'react';

import type { ObservedIngredientStatus } from '../form/ingredientStatus.js';

/**
 * Poll one pending food-backed line to resolution.
 *
 * @param ingredientId - The binding of the pending line to poll.
 * @param onStatus - Called with the polled id and what the poll observed — the binding the server answered with
 *   (a DIFFERENT id when the poll settled the line, plan 002) and its status — whenever a status is known. Must be
 *   idempotent: the caller patches state only when something changed, so repeated fires cannot loop.
 */
export function usePollIngredientStatus(
    ingredientId: string,
    onStatus: (polledId: string, observed: ObservedIngredientStatus) => void,
): void {
    const status = useIngredientStatus(ingredientId);
    const answeredId = status.data?.id;
    const observed = status.data?.foodResolutionStatus;
    // The food the answered binding names: a line that resolves here needs it, or its nutrition never counts.
    const foodId = status.data?.foodId;

    useEffect(() => {
        if (answeredId !== undefined && observed !== undefined) {
            onStatus(ingredientId, {
                id: answeredId,
                status: observed,
                ...(foodId === undefined ? {} : { foodId }),
            });
        }
    }, [ingredientId, answeredId, observed, foodId, onStatus]);
}
