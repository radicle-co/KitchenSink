/**
 * Unit tests for `nutritionLookup.ts` — the ONE background nutrition read per editor (plan 002 U9 batch,
 * `POST /api/v1/ingredients/food-nutrition`) turned into a per-line lookup that both the row panel and the running
 * total read (blueprint Decision 3). Nutrition never enters the draft; this is where it lives instead.
 *
 * ⛔ The two states that are easy to collapse and must not be: a ref MISSING from a placeholder answer (the previous
 * read, kept on screen while a new line's read is in flight) is still LOADING, not absent; and `absent` (food answered
 * with nothing the caller may read) is an answer, while `unavailable` (food could not be asked) is a failure.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import {
    foodRefOf,
    nutritionLookupFrom,
    nutritionReadFrom,
    refsOf,
    type FoodNutritionRef,
} from '../nutritionLookup.js';

const root = (id: string): FoodNutritionRef => ({ kind: 'root', id });
/** A line bound to `ref`'s food: a root ref is the line's `foodId`; a variant ref is its variant (under root `r`). */
const line = (ingredientId: string, ref?: FoodNutritionRef) => ({
    ingredientId,
    name: ingredientId,
    quantity: 1,
    isUserEntered: false,
    ...(ref === undefined
        ? {}
        : ref.kind === 'root'
          ? { foodId: ref.id }
          : { foodId: 'r', variant: { id: ref.id, parts: [{ attribute: 'cut', text: 'flat' }] } }),
});

/**
 * Curated U9: a line bound to a variant reads the VARIANT's numbers, and its `foodId` is the variant's root. Reading
 * the root's id for such a line showed the root's figures for a food the cook had made more specific.
 */
describe('foodRefOf — the food a binding reads its numbers from', () => {
    it.each<[string, { foodId?: string; variant?: { id: string } }, FoodNutritionRef | undefined]>([
        [
            'a variant binding, by its variant',
            { foodId: 'root-1', variant: { id: 'var-1' } },
            { kind: 'variant', id: 'var-1' },
        ],
        ['a root binding, by its root', { foodId: 'root-1' }, { kind: 'root', id: 'root-1' }],
        ['a binding that names no food, by nothing', {}, undefined],
    ])('reads %s', (_case, binding, ref) => {
        expect(foodRefOf(binding)).toEqual(ref);
    });
});

describe('refsOf', () => {
    it('collects each distinct ref once, in first-appearance order, skipping lines with no ref', () => {
        const values = makeRecipeFormValues({
            ingredients: withLineKeys([line('a', root('f2')), line('b'), line('c', root('f1')), line('d', root('f2'))]),
        });

        expect(refsOf(values)).toEqual([root('f2'), root('f1')]);
    });

    it('skips the ref of a line the verification gate has not cleared, unless a cleared line shares it', () => {
        const values = makeRecipeFormValues({
            ingredients: withLineKeys([
                { ...line('a', root('f1')), resolutionStatus: 'NEEDS_REVIEW' as const },
                { ...line('b', root('f2')), resolutionStatus: 'PENDING_VERIFICATION' as const },
                { ...line('c', root('f2')), resolutionStatus: 'RESOLVED' as const },
            ]),
        });

        expect(refsOf(values)).toEqual([root('f2')]);
    });

    it('is empty for a recipe with no food-backed line (and so no read is made)', () => {
        expect(refsOf(makeRecipeFormValues({ ingredients: withLineKeys([line('a')]) }))).toEqual([]);
    });
});

describe('nutritionLookupFrom', () => {
    const response = {
        entries: [
            {
                outcome: 'found' as const,
                ref: root('f1'),
                freshness: 'fresh' as const,
                caloriesPer100g: 130,
                proteinGPer100g: 2.7,
                portions: [{ unit: 'cup', gramsPerUnit: 158 }],
            },
            { outcome: 'absent' as const, ref: root('f2') },
            { outcome: 'unavailable' as const, ref: root('f3') },
        ],
    };

    it('reads every ref as LOADING while the first read is in flight', () => {
        expect(nutritionLookupFrom({ status: 'pending' })(root('f1'))).toEqual({ state: 'pending' });
    });

    it('reads every ref as FAILED when the read itself failed (offline, 5xx)', () => {
        expect(nutritionLookupFrom({ status: 'error' })(root('f1'))).toEqual({ state: 'failed' });
    });

    it('maps each answered outcome: found carries the catalog figures and portions; absent and unavailable differ', () => {
        const lookup = nutritionLookupFrom({ status: 'success', response, complete: true });

        expect(lookup(root('f1'))).toEqual({
            state: 'found',
            catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7, portions: [{ unit: 'cup', gramsPerUnit: 158 }] },
        });
        expect(lookup(root('f2'))).toEqual({ state: 'absent' });
        expect(lookup(root('f3'))).toEqual({ state: 'unavailable' });
    });

    it('⛔ a ref missing from a PLACEHOLDER answer is still loading — a new line is not "absent" while its read runs', () => {
        const lookup = nutritionLookupFrom({ status: 'success', response, complete: false });

        expect(lookup(root('f9'))).toEqual({ state: 'pending' });
        // Positive control: refs the placeholder DOES answer are read from it.
        expect(lookup(root('f2'))).toEqual({ state: 'absent' });
    });

    it('a ref missing from a COMPLETE answer reads as unavailable: the server owes one entry per ref', () => {
        expect(nutritionLookupFrom({ status: 'success', response, complete: true })(root('f9'))).toEqual({
            state: 'unavailable',
        });
    });

    /** Blueprint decision 4: the root's live variants ride on the lookup, never in the draft. */
    it.each([true, false])('carries a found root’s hasVariants %s beside its figures', (hasVariants) => {
        const lookup = nutritionLookupFrom({
            status: 'success',
            response: {
                entries: [{ outcome: 'found', ref: root('f1'), freshness: 'stale', portions: [], hasVariants }],
            },
            complete: true,
        });

        expect(lookup(root('f1'))).toStrictEqual({ state: 'found', catalog: {}, hasVariants });
    });

    it('leaves hasVariants out of a found entry that does not state it: not known, never false', () => {
        const lookup = nutritionLookupFrom({ status: 'success', response, complete: true });

        expect(lookup(root('f1'))).not.toHaveProperty('hasVariants');
    });

    it('keys refs by kind as well as id: a variant and a root with one id are different foods', () => {
        const lookup = nutritionLookupFrom({ status: 'success', response, complete: true });

        expect(lookup({ kind: 'variant', id: 'f1' })).toEqual({ state: 'unavailable' });
    });
});

describe('nutritionReadFrom — the query, as the lookup and the running total read it', () => {
    const response = { entries: [] };

    it('a draft with no food-backed line is READY with an empty answer: no read is owed', () => {
        expect(nutritionReadFrom(0, { data: undefined, isPlaceholderData: false, isError: false })).toEqual({
            status: 'success',
            response: { entries: [] },
            complete: true,
        });
    });

    it('is pending before the first answer, and an error when the read failed with nothing to show', () => {
        expect(nutritionReadFrom(1, { data: undefined, isPlaceholderData: false, isError: false })).toEqual({
            status: 'pending',
        });
        expect(nutritionReadFrom(1, { data: undefined, isPlaceholderData: false, isError: true })).toEqual({
            status: 'error',
        });
    });

    it('an answer is complete unless it is the previous read kept as a placeholder', () => {
        expect(nutritionReadFrom(2, { data: response, isPlaceholderData: false, isError: false })).toEqual({
            status: 'success',
            response,
            complete: true,
        });
        expect(nutritionReadFrom(2, { data: response, isPlaceholderData: true, isError: false })).toEqual({
            status: 'success',
            response,
            complete: false,
        });
    });

    it('an answer already on screen survives a failed refetch', () => {
        expect(nutritionReadFrom(1, { data: response, isPlaceholderData: false, isError: true })).toMatchObject({
            status: 'success',
        });
    });
});
