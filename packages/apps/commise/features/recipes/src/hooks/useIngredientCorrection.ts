/**
 * Headless-hook seam (CP-6/P2) — the shared ingredient-CORRECTION command, so the web and native
 * `IngredientPicker` leaves render the same state machine rather than two that happen to agree
 * (plan U14 / R19, R20).
 *
 * DESIGN PATTERN: **Command**, already satisfied by the TanStack mutation this wraps — no extra machinery is
 * added. What this hook contributes is the two things a leaf must NOT own: which phrase/food a correction is
 * about, and the projection of the mutation's raw flags into the discriminated
 * {@link CorrectionViewState} both leaves switch over.
 *
 * ## ⛔ It is a SEPARATE intent from picking the ingredient, and must stay separate
 *
 * The pick fixes THIS recipe line; the correction teaches the resolver what a phrase means for the future.
 * Chaining them would make one fail with the other in both directions, and both directions are wrong: a
 * momentarily unwritable knowledge base must never stop a cook adding an ingredient, and a correction that
 * fails must not roll back a line the user can see on screen. So the leaf renders this hook's state beside
 * the picker and lets the line stand regardless — which is also why the failure copy
 * says the ingredient was still added.
 *
 * ## ⚠️ Which phrase is corrected, and why it is the TYPED one
 *
 * The phrase must be the text the caller SEARCHED, because a curated mapping is only ever consulted under
 * the key the resolution cascade looks up — and that key is derived from the phrase `addByName` received,
 * never from the raw recipe line and never from the catalog's rendering of the food. Passing the resolved
 * ingredient's name instead would key the mapping on our own output: a row the cascade never queries, and
 * (were it ever queried) a system verifying its own answer against itself.
 *
 * Platform-agnostic: no DOM and no React Native imports.
 */
import { useCallback } from 'react';
import { useRecordIngredientCorrection } from '@kitchensink/recipe-service-client/hooks';
import type { CorrectionSurfacing } from '@kitchensink/schema-recipe';

import { toCorrectionViewState, type CorrectionViewState } from '../correction/model.js';

/** What a leaf gets to drive the correction affordance. */
export interface IngredientCorrectionController {
    /**
     * Record that `phrase` means `foodId`.
     *
     * @param phrase - The text the caller searched. Never the resolved ingredient's name.
     * @param foodId - The opaque food the phrase should resolve to.
     */
    readonly correct: (phrase: string, foodId: string) => void;
    /** The state the leaf renders, as one discriminated value rather than three raw flags. */
    readonly viewState: CorrectionViewState;
    /**
     * Whether a write is in flight — exposed separately ONLY so a leaf can disable its control.
     *
     * ⚠️ Derivable from `viewState.kind === 'saving'`, and deliberately not re-derived at two call sites per
     * leaf: `disabled` and `aria-busy` must never disagree about whether the control is working.
     */
    readonly isSaving: boolean;
}

/**
 * Drive the "teach the resolver" affordance for one picker.
 *
 * ⛔ `void`, not a returned promise, and the rejection is deliberately swallowed into the mutation's own
 * `isError`. `mutate` (not `mutateAsync`) is what makes an unhandled rejection structurally impossible here;
 * with `mutateAsync` a leaf that forgot `.catch` would produce an unhandled rejection on a path the user is
 * not blocked by, which on React Native surfaces as a redbox over a working screen.
 *
 * @param surfacing - Which affordance this picker is (R20's audit dimension). A CLOSED wire enum, so a
 *   surface cannot invent a value that makes the audit trail unaggregatable.
 * @returns The command, its view state, and its in-flight flag.
 * @sideEffect Issues `POST /api/v1/ingredients/corrections`, which writes to the resolution knowledge base.
 */
export function useIngredientCorrection(surfacing: CorrectionSurfacing): IngredientCorrectionController {
    const mutation = useRecordIngredientCorrection();
    const { mutate } = mutation;

    const correct = useCallback(
        (phrase: string, foodId: string): void => {
            mutate({ phrase, foodId, surfacing });
        },
        [mutate, surfacing],
    );

    return {
        correct,
        viewState: toCorrectionViewState({ isPending: mutation.isPending, isError: mutation.isError }, mutation.data),
        isSaving: mutation.isPending,
    };
}
