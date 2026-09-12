/**
 * Unit tests for an ingredient line's food-resolution bookkeeping (`form/ingredientStatus.ts`).
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, makeRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { pendingIngredientIds, settleIngredientLine, settleIngredientLines } from '../ingredientStatus.js';
import type { RecipeFormValues } from '../values.js';

describe('pendingIngredientIds (poll-after-add: which lines still resolve)', () => {
    it('returns only the catalog ids of PENDING lines, de-duplicated', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: withLineKeys([
                { isUserEntered: false, ingredientId: 'p1', name: 'Quinoa', quantity: 1, resolutionStatus: 'PENDING' },
                { isUserEntered: false, ingredientId: 'r1', name: 'Rice', quantity: 1, resolutionStatus: 'RESOLVED' },
                {
                    isUserEntered: false,
                    ingredientId: 'p1',
                    name: 'Quinoa again',
                    quantity: 2,
                    resolutionStatus: 'PENDING',
                },
                {
                    isUserEntered: false,
                    ingredientId: 'u1',
                    name: 'Ambiguous',
                    quantity: 1,
                    resolutionStatus: 'UNRESOLVED',
                },
            ]),
        });

        // Only PENDING ids, and p1 (twice) collapses to one — RESOLVED/UNRESOLVED are NOT polled.
        expect(pendingIngredientIds(values)).toEqual(['p1']);
    });

    it('never polls a line with no catalog id or with no status', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: withLineKeys([
                { isUserEntered: false, ingredientId: null, name: 'Blank', quantity: 1, resolutionStatus: 'PENDING' },
                { isUserEntered: false, ingredientId: 'x', name: 'Freeform', quantity: 1 },
            ]),
        });

        expect(pendingIngredientIds(values)).toEqual([]);
    });
});

describe('settleIngredientLine (poll-after-add: apply what the poll observed)', () => {
    const pendingValues = (): RecipeFormValues =>
        makeFilledRecipeFormValues({
            ingredients: withLineKeys([
                { isUserEntered: false, ingredientId: 'p1', name: 'Quinoa', quantity: 1, resolutionStatus: 'PENDING' },
                { isUserEntered: false, ingredientId: 'p1', name: 'Quinoa', quantity: 2, resolutionStatus: 'PENDING' },
                { isUserEntered: false, ingredientId: 'other', name: 'Rice', quantity: 1, resolutionStatus: 'PENDING' },
            ]),
        });

    it('flips EVERY line on the polled binding to the new status, leaving other lines untouched', () => {
        const next = settleIngredientLine(pendingValues(), 'p1', { id: 'p1', status: 'RESOLVED' });

        expect(next.ingredients.map((l) => l.resolutionStatus)).toEqual(['RESOLVED', 'RESOLVED', 'PENDING']);
    });

    it('⛔ ADOPTS the binding a settled poll answers with — the line now points where the server moved it (plan 002)', () => {
        const next = settleIngredientLine(pendingValues(), 'p1', { id: 'bound-1', status: 'RESOLVED' });

        expect(next.ingredients.map((l) => l.ingredientId)).toEqual(['bound-1', 'bound-1', 'other']);
        expect(next.ingredients.map((l) => l.resolutionStatus)).toEqual(['RESOLVED', 'RESOLVED', 'PENDING']);
    });

    it('returns the SAME reference when neither the id nor the status changed (no render loop)', () => {
        const values = pendingValues();

        expect(settleIngredientLine(values, 'p1', { id: 'p1', status: 'PENDING' })).toBe(values);
    });

    it('returns the SAME reference when no line is on the polled binding', () => {
        const values = pendingValues();

        expect(settleIngredientLine(values, 'missing', { id: 'bound-1', status: 'RESOLVED' })).toBe(values);
    });
});

/**
 * Finding #5 (plan 002 V1 B5): every catalog figure is behind `line.foodRef`, so a settle that resolves a line must
 * carry the food the server bound it to — the status answer's `foodId` (a root arm) — or the panel says "no data" and
 * the total leaves the line out until the recipe is reopened.
 */
describe('settleIngredientLine — the food the answer names', () => {
    const RICE = { kind: 'root', id: 'food_rice' } as const;
    const failedValues = (foodRef?: { readonly kind: 'root' | 'variant'; readonly id: string }): RecipeFormValues =>
        makeFilledRecipeFormValues({
            ingredients: withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: 'f1',
                    name: 'Saffron',
                    quantity: 1,
                    resolutionStatus: 'FAILED',
                    ...(foodRef === undefined ? {} : { foodRef }),
                },
                { isUserEntered: false, ingredientId: 'other', name: 'Rice', quantity: 1, resolutionStatus: 'PENDING' },
            ]),
        });

    it('gives a line resolved under a DIFFERENT binding the food that binding names', () => {
        const next = settleIngredientLine(failedValues(), 'f1', {
            id: 'bound-1',
            status: 'RESOLVED',
            foodId: 'food_saffron',
        });

        expect(next.ingredients[0]?.foodRef).toEqual({ kind: 'root', id: 'food_saffron' });
        expect(next.ingredients[1]?.foodRef).toBeUndefined();
    });

    it('drops the food of a line moved to a binding that names none', () => {
        const next = settleIngredientLine(failedValues(RICE), 'f1', { id: 'bound-1', status: 'NOT_FOUND' });

        expect(next.ingredients[0]).not.toHaveProperty('foodRef');
    });

    it('keeps the food of a line whose binding did not move and whose answer names none', () => {
        const next = settleIngredientLine(failedValues(RICE), 'f1', { id: 'f1', status: 'NOT_FOUND' });

        expect(next.ingredients[0]?.foodRef).toEqual(RICE);
    });

    it('counts a changed food alone as a change (same binding, same status)', () => {
        const values = failedValues(RICE);
        const next = settleIngredientLine(values, 'f1', { id: 'f1', status: 'FAILED', foodId: 'food_saffron' });

        expect(next).not.toBe(values);
        expect(next.ingredients[0]?.foodRef).toEqual({ kind: 'root', id: 'food_saffron' });
    });

    it('returns the SAME reference when the answer names the food the line already has (no render loop)', () => {
        const values = failedValues(RICE);

        expect(settleIngredientLine(values, 'f1', { id: 'f1', status: 'FAILED', foodId: RICE.id })).toBe(values);
    });

    it('replaces a VARIANT ref with the root the answer names', () => {
        const next = settleIngredientLine(failedValues({ kind: 'variant', id: 'food_rice' }), 'f1', {
            id: 'f1',
            status: 'RESOLVED',
            foodId: 'food_rice',
        });

        expect(next.ingredients[0]?.foodRef).toEqual(RICE);
    });
});

/**
 * Staff-architect REVIEW F1 (plan 002 V1): several answers applied as ONE draft transition. A host whose setter takes a
 * value (not an updater) and that applied answers one call at a time built every write from the same snapshot, so the
 * last write won and an earlier answer was lost — for good, because it replayed in the same order on every edit.
 */
describe('settleIngredientLines — several answers, one transition', () => {
    const two = makeRecipeFormValues({
        ingredients: withLineKeys([
            { ingredientId: 'a', name: 'A', quantity: 1, isUserEntered: false, resolutionStatus: 'FAILED' },
            { ingredientId: 'b', name: 'B', quantity: 1, isUserEntered: false, resolutionStatus: 'FAILED' },
        ]),
    });

    it('applies EVERY answer to the one draft', () => {
        const next = settleIngredientLines(two, [
            { polledId: 'a', observed: { id: 'a', status: 'NOT_FOUND' } },
            { polledId: 'b', observed: { id: 'b', status: 'RESOLVED' } },
        ]);

        expect(next.ingredients.map((line) => line.resolutionStatus)).toEqual(['NOT_FOUND', 'RESOLVED']);
    });

    it('returns the SAME draft when no answer changes anything (a no-op must not look like an edit)', () => {
        expect(
            settleIngredientLines(two, [
                { polledId: 'a', observed: { id: 'a', status: 'FAILED' } },
                { polledId: 'b', observed: { id: 'b', status: 'FAILED' } },
            ]),
        ).toBe(two);
    });
});
