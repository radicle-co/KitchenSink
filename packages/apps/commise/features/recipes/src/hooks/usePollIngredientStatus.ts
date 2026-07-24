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
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { useEffect } from 'react';

/**
 * Poll one pending food-backed line to resolution.
 *
 * @param ingredientId - The catalog ingredient id of the pending line to poll.
 * @param onStatus - Called with the ingredient id + the latest observed resolution status whenever a
 *   status is known. Must be idempotent — the caller is responsible for only patching state when the
 *   status actually changed, so the repeated callback fires cannot loop.
 */
export function usePollIngredientStatus(
    ingredientId: string,
    onStatus: (ingredientId: string, status: FoodResolutionStatus) => void,
): void {
    const status = useIngredientStatus(ingredientId);
    const observed = status.data?.foodResolutionStatus;

    useEffect(() => {
        if (observed !== undefined) {
            onStatus(ingredientId, observed);
        }
    }, [ingredientId, observed, onStatus]);
}
