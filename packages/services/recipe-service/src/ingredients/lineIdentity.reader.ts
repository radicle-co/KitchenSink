/**
 * The ONE place a recipe line's bindings become identities (plan 002 R9, R10): food is asked once, in one batch,
 * about every bound arm, and each arm's identity is derived from its answer by the pure
 * `deriveIngredientLineIdentity`.
 *
 * The write planner and the detail assembler both read names through this class, and the picker's answer for a
 * settled failure through {@link identifyArmsThrough} beneath it, so a saved line, a read line and a picked line
 * cannot be named two ways. It holds no transaction and must be called outside one: it makes a network call.
 *
 * @pattern Imperative Shell — batched I/O around the pure identity derivation
 */
import { Injectable } from '@nestjs/common';

import type { CallerToken } from '../auth/CallerToken.js';
import { foodRefOf, type FoodLookupArm, type FoodRef } from '../database/schema/foodLookupArm.js';
import { FoodLookupsDal } from './dal/foodLookups.dal.js';
import { deriveIngredientLineIdentity, type IngredientLineIdentity } from './domain/ingredientLineIdentity.js';
import type { FoodRefAnswer } from './domain/foodRefAnswer.js';
import { FoodRefsGateway } from './foodRefs.gateway.js';
import type { NutritionReadBudget } from './foodNutrition.gateway.js';

@Injectable()
export class LineIdentityReader {
    /**
     * @param lookups - The bindings repository.
     * @param refs - Food's answer about a referenced food.
     */
    public constructor(
        private readonly lookups: FoodLookupsDal,
        private readonly refs: FoodRefsGateway,
    ) {}

    /**
     * Derive identities for bindings already loaded.
     *
     * @param caller - The reader's credential, forwarded to food.
     * @param arms - The bindings, by lookup id.
     * @param budget - The latency contract the food request runs under.
     * @returns Identities by lookup id, one per arm.
     * @sideEffect At most one batched food request.
     */
    public async identifyArms(
        caller: CallerToken | undefined,
        arms: ReadonlyMap<string, FoodLookupArm>,
        budget: NutritionReadBudget,
    ): Promise<ReadonlyMap<string, IngredientLineIdentity>> {
        return identifyArmsThrough(this.refs, caller, arms, budget);
    }

    /**
     * Derive identities for stored bindings by id.
     *
     * @param caller - The reader's credential.
     * @param lookupIds - The bindings.
     * @param budget - The latency contract the food request runs under.
     * @returns Identities by lookup id; a binding that no longer exists is absent.
     * @sideEffect One bindings read and at most one batched food request.
     */
    public async identify(
        caller: CallerToken | undefined,
        lookupIds: readonly string[],
        budget: NutritionReadBudget,
    ): Promise<ReadonlyMap<string, IngredientLineIdentity>> {
        return this.identifyArms(caller, await this.lookups.findByIds(lookupIds), budget);
    }
}

/**
 * Derive identities for bindings already loaded, asking food through `refs`: the body of
 * {@link LineIdentityReader.identifyArms}, for a caller that holds the gateway but not the reader.
 *
 * @param refs - Food's answer about referenced foods.
 * @param caller - The reader's credential, forwarded to food.
 * @param arms - The bindings, by lookup id.
 * @param budget - The latency contract the food request runs under.
 * @returns Identities by lookup id, one per arm.
 * @sideEffect At most one batched food request.
 */
export async function identifyArmsThrough(
    refs: Pick<FoodRefsGateway, 'resolve'>,
    caller: CallerToken | undefined,
    arms: ReadonlyMap<string, FoodLookupArm>,
    budget: NutritionReadBudget,
): Promise<ReadonlyMap<string, IngredientLineIdentity>> {
    const asked = [...arms.values()].flatMap((arm): FoodRef[] => {
        const ref = foodRefOf(arm);

        return ref === undefined ? [] : [ref];
    });
    const answers: ReadonlyMap<string, FoodRefAnswer> =
        asked.length === 0 ? new Map() : (await refs.resolve(caller, asked, budget)).answers;

    return new Map([...arms].map(([id, arm]) => [id, deriveIngredientLineIdentity(arm, answers)]));
}
