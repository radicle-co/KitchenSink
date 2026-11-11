/**
 * The bulk import's view of a cook's private slots (ADR-0073, ADR-0072 §9).
 *
 * DESIGN PATTERN: **Port (hexagonal)** with one **Adapter**, {@link privateSlotsOf}, over the recipe service's live count
 * (`getPrivateSlotUsage`). The slot count, the per-user lock and the `PRIVATE_SLOTS_FULL` denial belong to the recipe service;
 * the import only reads them:
 *
 *  - It is a NON-LOCKING READ and an ADVISORY one. The authoritative check runs inside the recipe's own transaction under the
 *    per-user advisory lock (ADR-0073 §5), where `RecipesService.create` takes it; "a slot fact computed before the
 *    transaction is never trusted". So the importer treats a `true` from it as "worth trying" and a `PRIVATE_SLOTS_FULL`
 *    thrown by the save as the truth.
 *  - It exists so the view can DERIVE the pause (§8: the pause is derived from the live count and never stored) and so a
 *    cook who is already out of slots is not sent through a doomed save per recipe.
 *  - It takes the PRINCIPAL, not a user id: whether the cook has Pro (no limit) is read from their signed token, as on every
 *    other route.
 */
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { Principal } from '../auth/principal.js';
import { hasFreePrivateSlot } from '../recipes/domain/privateSlotPolicy.js';
import { isRecipeDomainError } from '../recipes/recipe.error.js';
import type { RecipesService } from '../recipes/recipes.service.js';

/** DI token for {@link PrivateSlotsPort}. */
export const PRIVATE_SLOTS = 'IMPORT_PRIVATE_SLOTS';

/**
 * Whether a thrown value is the save path's "no private slot left" denial (ADR-0073 §3).
 *
 * @param error - Anything thrown by the create path.
 * @returns Whether it is the denial. Pure.
 */
export function isPrivateSlotsFull(error: unknown): boolean {
    return isRecipeDomainError(error) && error.code === RecipeErrorCode.PRIVATE_SLOTS_FULL;
}

export interface PrivateSlotsPort {
    /**
     * Whether the cook has at least one private slot free right now.
     *
     * @param principal - The verified cook.
     * @returns `true` when one is free (or the cook has no limit). Advisory, not a reservation.
     */
    hasAvailable(principal: Principal): Promise<boolean>;
}

/**
 * The port over the recipe service's live count. Pro has no limit; a free cook has a slot while they hold fewer than the
 * limit (`hasFreePrivateSlot`, the one statement of that rule).
 *
 * @param recipes - The recipe service, or anything that answers its slot read.
 */
export function privateSlotsOf(recipes: Pick<RecipesService, 'getPrivateSlotUsage'>): PrivateSlotsPort {
    return {
        hasAvailable: async (principal) => {
            const usage = await recipes.getPrivateSlotUsage(principal);

            return usage.kind === 'unlimited' || hasFreePrivateSlot(usage, usage.used);
        },
    };
}
