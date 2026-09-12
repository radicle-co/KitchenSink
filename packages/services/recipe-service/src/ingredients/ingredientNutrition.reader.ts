/**
 * The batch food nutrition read (plan 002 U9, R31): the owners of privately bound roots and food's nutrition, read
 * concurrently, then answered by the pure `foodNutritionAnswer`.
 *
 * ⛔ It asks food about every root ref, bound or not. The details dialog sorts a root's variants by calories before
 * the cook picks one, so a bound-only allowlist would break it; food's own rules decide what the caller may read.
 *
 * @pattern Imperative Shell — two concurrent reads around the pure answer
 */
import { Inject, Injectable } from '@nestjs/common';

import type { FoodRef } from '@kitchensink/schema-food';

import type { CallerToken } from '../auth/CallerToken.js';
import { FoodLookupsDal } from './dal/foodLookups.dal.js';
import { foodNutritionAnswer } from './domain/foodNutritionAnswer.js';
import { FoodNutritionGateway } from './foodNutrition.gateway.js';
import type { IngredientFoodNutritionEntry } from './ingredients.schema.js';

@Injectable()
export class IngredientNutritionReader {
    /**
     * @param lookups - The bindings repository, for the owners of private bindings.
     * @param nutrition - Food's nutrition, read as the caller.
     */
    public constructor(
        @Inject(FoodLookupsDal) private readonly lookups: Pick<FoodLookupsDal, 'findPrivateRootOwners'>,
        @Inject(FoodNutritionGateway) private readonly nutrition: Pick<FoodNutritionGateway, 'lookup'>,
    ) {}

    /**
     * Answer every distinct ref.
     *
     * @param callerId - The verified caller.
     * @param caller - The caller's credential, forwarded to food; without one, food is not asked.
     * @param refs - The refs asked about.
     * @returns One entry per distinct ref, in order of first appearance.
     * @sideEffect One `food_lookups` read and at most one batched food lookup, concurrently.
     */
    public async read(
        callerId: string,
        caller: CallerToken | undefined,
        refs: readonly FoodRef[],
    ): Promise<IngredientFoodNutritionEntry[]> {
        const rootIds = [...new Set(refs.filter((ref) => ref.kind === 'root').map((ref) => ref.id))];
        const [owners, reading] = await Promise.all([
            this.lookups.findPrivateRootOwners(rootIds),
            this.nutrition.lookup(caller, rootIds, 'read'),
        ]);

        return foodNutritionAnswer(refs, callerId, owners, reading);
    }
}
