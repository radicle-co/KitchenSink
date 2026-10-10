/**
 * What one recipe line shows on the DETAIL wire, composed from its identity and its FINAL status — the status
 * after `resolveLineStatus → foodPresenceStatus → viewerLineStatus` (plan 002 R9, R46, R47, R6).
 *
 * Four rules live here and nowhere else:
 * - A viewer who may not see the line's food (`RESOLVED_UNAVAILABLE`) gets none of its name, root, variant or
 *   `hasVariants`.
 * - A line with no name to show reaches the wire only under one of `NAMELESS_LINE_STATUSES`, which tell the
 *   client which label to render. Composing one under any other status throws: it would be a lie on the wire.
 * - Only an unresolved line carries a reason code.
 * - `foodId` is the LIVE ROOT food named on this read (curated U9), on root- and variant-bound lines alike; `variant`
 *   appears exactly when that food is a variant, and `hasVariants` exactly when it is a root. The one exception is a
 *   ROOT line food could not be asked about: it keeps its bound id, the only root it can know.
 *
 * @pattern Data Mapper — pure composition of the line's identity and its viewer-final status
 */
import {
    FoodResolutionStatus,
    NAMELESS_LINE_STATUSES,
    type IngredientVariant,
    type LineResolutionStatus,
    type UnresolvedFoodReasonCode,
} from '@kitchensink/recipe-core';

import {
    isUserEnteredOf,
    lineNameOf,
    type IngredientLineIdentity,
    type LineFood,
} from '../../ingredients/domain/ingredientLineIdentity.js';

/** The line fields the detail wire carries beyond the line's own quantity, unit, notes and section. */
export interface IngredientLineView {
    readonly name?: string;
    readonly foodId?: string;
    readonly variant?: IngredientVariant;
    readonly hasVariants?: boolean;
    readonly unresolvedReason?: UnresolvedFoodReasonCode;
    readonly isUserEntered: boolean;
    readonly resolutionStatus?: LineResolutionStatus;
}

/** What food's nutrition batch said about the line's food on this read (it may be served stale). */
export interface LineViewFoodFacts {
    /** Whether the line's root has a live variant, from the batch entry; absent when the batch has none. */
    readonly hasLiveVariants?: boolean;
}

/**
 * The food a line shows: food's answer, or — for a ROOT line food could not be asked about — its bound id. Pure.
 *
 * @param identity - The line's identity.
 * @returns The food, or `undefined` when there is none to show.
 */
function shownFoodOf(identity: IngredientLineIdentity): LineFood | undefined {
    if (identity.food !== undefined) {
        return identity.food;
    }

    const { arm } = identity;

    return arm.kind === 'root' && identity.presence === 'unreachable' ? { rootId: arm.foodId } : undefined;
}

/**
 * Whether a status is one a line may carry without a name.
 *
 * @param status - A final line status.
 * @returns `true` for a member of `NAMELESS_LINE_STATUSES`. Pure.
 */
function allowsNoName(status: LineResolutionStatus | undefined): boolean {
    return status !== undefined && (NAMELESS_LINE_STATUSES as readonly string[]).includes(status);
}

/**
 * Compose one line's detail view.
 *
 * @param identity - The line's identity.
 * @param finalStatus - The line's status after every overlay, the viewer overlay last.
 * @param facts - What food's nutrition batch said about the line's food.
 * @returns The view.
 * @throws {Error} when the line has no name and the status does not say why — a caller that skipped an overlay.
 *   Pure.
 */
export function composeIngredientLineView(
    identity: IngredientLineIdentity,
    finalStatus: LineResolutionStatus | undefined,
    facts: LineViewFoodFacts = {},
): IngredientLineView {
    const hidden = finalStatus === FoodResolutionStatus.RESOLVED_UNAVAILABLE;
    const name = hidden ? undefined : lineNameOf(identity);

    if (name === undefined && !allowsNoName(finalStatus)) {
        throw new Error(
            `food lookup ${identity.arm.lookupId} has no name to show, and status ${String(finalStatus)} does not say why`,
        );
    }

    const { arm } = identity;
    const food = hidden ? undefined : shownFoodOf(identity);

    return {
        ...(name === undefined ? {} : { name }),
        ...(food === undefined ? {} : { foodId: food.rootId }),
        ...(food?.variant === undefined ? {} : { variant: food.variant }),
        ...(food === undefined || food.variant !== undefined ? {} : { hasVariants: facts.hasLiveVariants ?? false }),
        ...(arm.kind === 'unresolved' ? { unresolvedReason: arm.failure.reasonCode } : {}),
        isUserEntered: isUserEnteredOf(identity),
        ...(finalStatus === undefined ? {} : { resolutionStatus: finalStatus }),
    };
}
