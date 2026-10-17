/**
 * The answer of the batch food nutrition read, one entry per distinct ref (plan 002 U9, R31).
 *
 * Food decides what the caller may read: it answered each id, or it was not asked. This service's binding data decides
 * CONCEALMENT, and concealment is applied last (R49), so it can never degrade into a factual answer. A root bound
 * privately to another user answers exactly what an unknown id answers in the same read (R46, R50): `absent` when
 * food answered that id's request, `unavailable` when it did not. That holds even when food returned numbers, and even
 * for a stale value the cache recovered. Only a ROOT can be private, so only a root ref is ever concealed.
 *
 * A variant is answered from food's reading of its id, exactly as a root (curated U9): food's batch serves a variant's
 * own numbers. Food's batch ignores KIND — ids are one namespace — so a ref sent under the wrong kind is answered from
 * food's reading of its id and echoed back with the kind the caller sent.
 *
 * @pattern Functional Core — a pure mapping of food's reading and the binding owners onto the wire entries; the
 *   reader is its Imperative Shell
 */
import type { FoodRef } from '@kitchensink/schema-food';

import { foodRefKey, isStrangerToPrivateFood } from '../../database/schema/foodLookupArm.js';
import type { FoodNutritionEntry, FoodNutritionLookup } from '../foodNutrition.gateway.js';
import type { IngredientFoodNutritionEntry } from '../ingredients.schema.js';

/** What food told this read about the ids it was asked for. */
type FoodReading = Pick<FoodNutritionLookup, 'byFoodId' | 'unansweredIds'>;

/**
 * The entry an id gets when food returned nothing the caller may read: `absent` if food answered, `unavailable` if
 * it was not asked. Pure.
 */
function withoutFigures(ref: FoodRef, reading: FoodReading): IngredientFoodNutritionEntry {
    return { outcome: reading.unansweredIds.has(ref.id) ? 'unavailable' : 'absent', ref };
}

/**
 * A found entry: food's figures and this read's freshness, each named, so a field added to the gateway's entry never
 * reaches the wire unseen. The status stays on the line view. `hasVariants` is a ROOT's alone: food's batch ignores
 * kind, so a variant ref holding a root's id would otherwise carry the root's flag. Pure.
 */
function found(ref: FoodRef, entry: FoodNutritionEntry): IngredientFoodNutritionEntry {
    return {
        outcome: 'found',
        ref,
        freshness: entry.freshness,
        ...(entry.caloriesPer100g === undefined ? {} : { caloriesPer100g: entry.caloriesPer100g }),
        ...(entry.proteinGPer100g === undefined ? {} : { proteinGPer100g: entry.proteinGPer100g }),
        ...(entry.carbsGPer100g === undefined ? {} : { carbsGPer100g: entry.carbsGPer100g }),
        ...(entry.fatGPer100g === undefined ? {} : { fatGPer100g: entry.fatGPer100g }),
        portions: entry.portions.map((portion) => ({ unit: portion.unit, gramsPerUnit: portion.gramsPerUnit })),
        ...(ref.kind !== 'root' || entry.hasLiveVariants === undefined ? {} : { hasVariants: entry.hasLiveVariants }),
    };
}

/**
 * Answer one ref, the concealment rule last. Pure.
 *
 * @param ref - The ref.
 * @param callerId - The reader, or `undefined` for none.
 * @param privateOwners - The owner of each privately bound root among the refs.
 * @param reading - What food told the read.
 * @returns The ref's entry.
 */
function answerOne(
    ref: FoodRef,
    callerId: string | undefined,
    privateOwners: ReadonlyMap<string, string>,
    reading: FoodReading,
): IngredientFoodNutritionEntry {
    const entry = reading.byFoodId.get(ref.id);
    const factual = entry === undefined ? withoutFigures(ref, reading) : found(ref, entry);
    const concealed = ref.kind === 'root' && isStrangerToPrivateFood(privateOwners.get(ref.id), callerId);

    // ⛔ Last (R49): another user's private food answers as an unknown id does, whatever food returned.
    return concealed ? withoutFigures(ref, reading) : factual;
}

/**
 * Answer every distinct ref, in order of first appearance.
 *
 * @param refs - The refs the caller asked about, possibly repeated.
 * @param callerId - The reader, or `undefined` for none.
 * @param privateOwners - The owner of each privately bound root among the refs, whoever the owner is.
 * @param reading - What food told the read about the refs' ids.
 * @returns One entry per distinct ref. Pure.
 */
export function foodNutritionAnswer(
    refs: readonly FoodRef[],
    callerId: string | undefined,
    privateOwners: ReadonlyMap<string, string>,
    reading: FoodReading,
): IngredientFoodNutritionEntry[] {
    const distinct = new Map(refs.map((ref) => [foodRefKey(ref), ref]));

    return [...distinct.values()].map((ref) => answerOne(ref, callerId, privateOwners, reading));
}
