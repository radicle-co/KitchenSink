/**
 * @module @commise/features-recipes/hooks — the recipe detail's ambiguity review pick: one food chosen for one
 * `AMBIGUOUS` line re-points THAT line (owner ruling 2026-10-02, "Fix one line at a time"), the way the editor's row 7
 * does for a stored line (`docs/design/rowEditorBlueprint.md` decision 7).
 *
 * The line is stored, so the pick goes through the rebind command, which is also where the correction is taught, keyed
 * on the line's own phrase (ADR-0045). The command answers the whole recipe and the client writes it through to the
 * detail read (`useRebindIngredientLine`), so the line leaves the review by itself once it is no longer ambiguous.
 *
 * A remote food (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P12) is adopted first, and the root it
 * became then re-points the line, as ONE pick (ADR-0055 point 10). Each of the adopt's refusals names its line and how
 * it ended (P8), and the cook's own limit, held for the review, stops a remote pick before it asks (item 10).
 *
 * ⛔ One pick at a time, across every row: each pick is a compare-and-swap on the version the detail read, so a second
 * pick sent before the first answers would meet a `409` against the first's write. A conflict means the detail read is
 * stale, so it is asked again, and the next pick sends the version the recipe has now.
 *
 * Platform-agnostic: no DOM and no React Native imports. Both review leaves render the same controller.
 *
 * @pattern Command — each pick is one rebind mutation, a remote food's adopt first, refused while another is in flight
 */
import { useAdoptRemoteFood } from '@kitchensink/food-service-client/hooks';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { isVersionConflictError, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { useRebindIngredientLine } from '@kitchensink/recipe-service-client/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { ReviewPick } from '../detail/model.js';
import { adoptRefusalOf, type RemoteFoodPick, type RemotePickRefusal } from './lineCommit.js';
import { isSourceLimited } from './sourceLimit.model.js';
import { useSourceLimit } from './useSourceLimit.js';

/** A pick that re-pointed nothing: its line, what was chosen, and how it ended. */
export interface ReviewPickFailure {
    readonly position: number;
    readonly pick: ReviewPick;
    readonly outcome: RemotePickRefusal;
}

/** A remote pick in flight: its line, and the food being added from its source. */
export interface ReviewRemotePick {
    readonly position: number;
    readonly pick: RemoteFoodPick;
}

/** What the review leaves render and wire. */
export interface AmbiguityPickController {
    /**
     * Re-point the stored line at `position` to `pick`, at the version the detail read: a root by id, or a remote food
     * adopted first. A no-op while a pick is in flight; a remote pick while the cook's limit stands makes no request.
     *
     * @param onGone - Called when food refused the remote food, so the row asks its search again (P8).
     */
    readonly pick: (position: number, pick: ReviewPick, onGone?: () => void) => void;
    /** A pick is in flight, adopt or rebind, so every candidate on the surface is busy. */
    readonly picking: boolean;
    /**
     * The remote pick in flight, through its adopt and its re-point: its row says what it is adding, and from where
     * (`docs/design/rowEditorOpenDecisions.md` V3-9, P8).
     */
    readonly adding: ReviewRemotePick | undefined;
    /** The stored position of the line whose last pick re-pointed nothing. */
    readonly failedAt: number | undefined;
    /** The last pick that re-pointed nothing, and how it ended. */
    readonly failure: ReviewPickFailure | undefined;
    /** The stored position of the line whose pick the recipe took, when the last pick was taken. */
    readonly takenAt: number | undefined;
    /** How many picks the recipe has taken: the focus signal's count (`reviewRowsGone` on web). */
    readonly saves: number;
    /** The remote picks the cook's limit refused before asking: each says it again (R8). */
    readonly limitRefusals: number;
    /** The review's limit holder: a row's search holds it from a source frame (system change 9). */
    readonly holdLimit: (until: number) => void;
}

/**
 * Drive the review's picks for one recipe.
 *
 * ⛔ `mutate`, never `mutateAsync`: a refusal lands in the controller's own state, which the row renders, and a leaf
 * cannot leave a rejection unhandled.
 *
 * @param recipe - The recipe the detail read: its id, and the version every pick edits.
 * @returns The pick command and its state.
 * @sideEffect Adopts a remote food (`POST /api/v1/foods/remote/adopt`), issues
 *   `POST /api/v1/recipes/{id}/ingredients/{position}/rebind`, and on a version conflict marks the detail read stale.
 */
export function useAmbiguityPick(recipe: Pick<RecipeDetail, 'id' | 'currentVersion'>): AmbiguityPickController {
    const rebind = useRebindIngredientLine();
    const adopt = useAdoptRemoteFood();
    const sourceLimit = useSourceLimit();
    const queryClient = useQueryClient();
    const [saves, setSaves] = useState(0);
    const [failure, setFailure] = useState<ReviewPickFailure | undefined>(undefined);
    const [limitRefusals, setLimitRefusals] = useState(0);
    // The last pick that asked food for a remote food; it names the pick in flight only while one is.
    const [remotePick, setRemotePick] = useState<ReviewRemotePick | undefined>(undefined);

    /** Re-point the line at `position` to the root `foodId`. */
    const repoint = (position: number, foodId: string, pick: ReviewPick): void => {
        rebind.mutate(
            {
                id: recipe.id,
                position,
                body: { expectedVersion: recipe.currentVersion, target: { kind: 'catalogFood', foodId } },
            },
            {
                onSuccess: () => {
                    setSaves((count) => count + 1);
                },
                onError: (error) => {
                    setFailure({ position, pick, outcome: { kind: 'failed' } });

                    if (isVersionConflictError(error)) {
                        void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(recipe.id) });
                    }
                },
            },
        );
    };

    const pick = (position: number, chosen: ReviewPick, onGone?: () => void): void => {
        // The controller, not the control, refuses a second pick: a web candidate stays focusable (`aria-disabled`,
        // never native `disabled`, which drops focus — WCAG 2.2 SC 2.4.3), so a press still reaches here.
        if (rebind.isPending || adopt.isPending) {
            return;
        }

        if (
            chosen.kind === 'remoteFood' &&
            sourceLimit.retryAt !== undefined &&
            isSourceLimited(sourceLimit, Date.now())
        ) {
            setLimitRefusals((count) => count + 1);
            setFailure({ position, pick: chosen, outcome: { kind: 'limited', retryAt: sourceLimit.retryAt } });

            return;
        }

        setFailure(undefined);

        if (chosen.kind === 'catalogFood') {
            setRemotePick(undefined);
            repoint(position, chosen.foodId, chosen);

            return;
        }

        setRemotePick({ position, pick: chosen });
        adopt.mutate(chosen.reference, {
            onSuccess: (root) => {
                repoint(position, root.id, chosen);
            },
            onError: (error) => {
                const outcome = adoptRefusalOf(error, Date.now());

                if (outcome.kind === 'limited') {
                    sourceLimit.hold(outcome.retryAt);
                }

                if (outcome.kind === 'remoteGone') {
                    onGone?.();
                }

                setFailure({ position, pick: chosen, outcome });
            },
        });
    };

    const picking = rebind.isPending || adopt.isPending;

    return {
        pick,
        picking,
        adding: picking ? remotePick : undefined,
        failedAt: failure?.position,
        failure,
        takenAt: rebind.isSuccess ? rebind.variables.position : undefined,
        saves,
        limitRefusals,
        holdLimit: sourceLimit.hold,
    };
}
