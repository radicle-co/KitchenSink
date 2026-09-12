/**
 * What one recipe line shows on the DETAIL wire, composed from its identity and its FINAL status — the status
 * after `resolveLineStatus → foodPresenceStatus → viewerLineStatus` (plan 002 R9, R46, R47, R6).
 *
 * Three rules live here and nowhere else:
 * - A viewer who may not see the line's food (`RESOLVED_UNAVAILABLE`) gets neither its name nor its id.
 * - A line with no name to show reaches the wire only under one of `NAMELESS_LINE_STATUSES`, which tell the
 *   client which label to render. Composing one under any other status throws: it would be a lie on the wire.
 * - Only an unresolved line carries a reason code, and only a root-bound line carries a food id.
 *
 * @pattern Data Mapper — pure composition of the line's identity and its viewer-final status
 */
import {
    FoodResolutionStatus,
    NAMELESS_LINE_STATUSES,
    type LineResolutionStatus,
    type UnresolvedFoodReasonCode,
} from '@kitchensink/recipe-core';

import {
    isUserEnteredOf,
    lineNameOf,
    type IngredientLineIdentity,
} from '../../ingredients/domain/ingredientLineIdentity.js';

/** The line fields the detail wire carries beyond the line's own quantity, unit, notes and section. */
export interface IngredientLineView {
    readonly name?: string;
    readonly foodId?: string;
    readonly unresolvedReason?: UnresolvedFoodReasonCode;
    readonly isUserEntered: boolean;
    readonly resolutionStatus?: LineResolutionStatus;
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
 * @returns The view.
 * @throws {Error} when the line has no name and the status does not say why — a caller that skipped an overlay.
 *   Pure.
 */
export function composeIngredientLineView(
    identity: IngredientLineIdentity,
    finalStatus: LineResolutionStatus | undefined,
): IngredientLineView {
    const hidden = finalStatus === FoodResolutionStatus.RESOLVED_UNAVAILABLE;
    const name = hidden ? undefined : lineNameOf(identity);

    if (name === undefined && !allowsNoName(finalStatus)) {
        throw new Error(
            `food lookup ${identity.arm.lookupId} has no name to show, and status ${String(finalStatus)} does not say why`,
        );
    }

    const { arm } = identity;

    return {
        ...(name === undefined ? {} : { name }),
        ...(arm.kind === 'root' && !hidden ? { foodId: arm.foodId } : {}),
        ...(arm.kind === 'unresolved' ? { unresolvedReason: arm.failure.reasonCode } : {}),
        isUserEntered: isUserEnteredOf(identity),
        ...(finalStatus === undefined ? {} : { resolutionStatus: finalStatus }),
    };
}
