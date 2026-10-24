/**
 * The picker's `Ingredient` wire shape, projected from a line identity (plan 002 U7).
 *
 * The shape the apps already consume is kept: `id` is now the binding (`food_lookups`) id, and `foodResolutionStatus`
 * and `isUserEntered` are derived from the binding, never stored (R15). The name comes from the identity, the ONE name
 * derivation (R10). `foodId` is the LIVE root food named, and `variant` appears when that food is a variant (curated
 * U9) — the same derivation the recipe line view makes.
 *
 * @pattern Data Mapper — pure, over the line identity
 */
import type { Ingredient } from '@kitchensink/recipe-core';

import {
    catalogStatusOf,
    isUserEnteredOf,
    lineNameOf,
    type IngredientLineIdentity,
} from './domain/ingredientLineIdentity.js';

/**
 * Project a binding the picker just added, polled or settled.
 *
 * @param identity - The binding's identity, with the name food just gave for a bound one.
 * @returns The picker's ingredient.
 * @throws {Error} when the binding has no name: every picker path asks food for the name first, so a missing
 *   one is a defect in the caller, never a state the picker can render. Pure.
 */
export function toIngredient(identity: IngredientLineIdentity): Ingredient {
    const name = lineNameOf(identity);

    if (name === undefined) {
        throw new Error(`food lookup ${identity.arm.lookupId} has no name to give the picker`);
    }

    const { arm } = identity;
    const status = catalogStatusOf(identity);

    return {
        id: arm.lookupId,
        name,
        ...(identity.food === undefined ? {} : { foodId: identity.food.rootId }),
        ...(identity.food?.variant === undefined ? {} : { variant: identity.food.variant }),
        ...(status === undefined ? {} : { foodResolutionStatus: status }),
        isUserEntered: isUserEnteredOf(identity),
        createdAt: arm.createdAt.toISOString(),
    };
}
