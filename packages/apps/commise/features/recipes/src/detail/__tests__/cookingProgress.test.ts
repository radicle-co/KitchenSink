/**
 * Unit tests for the session-scoped cooking-progress store (W2 Task 2.4). Pins the contract the detail
 * view depends on: per-recipe isolation, toggle semantics, subscriber notification, and — crucially — the
 * reference stability `useSyncExternalStore` needs (an untouched recipe always yields the SAME snapshot, a
 * toggled one yields a NEW snapshot without mutating the old).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProgress, resetCookingProgress, subscribe, toggleIngredient, toggleStep } from '../cookingProgress.js';

afterEach(() => resetCookingProgress());

describe('cookingProgress store', () => {
    it('returns a reference-stable empty snapshot for an untouched recipe', () => {
        expect(getProgress('rec_1')).toBe(getProgress('rec_2'));
        expect(getProgress('rec_1').ingredients.size).toBe(0);
        expect(getProgress('rec_1').steps.size).toBe(0);
    });

    it('toggles an ingredient on and off for a specific recipe', () => {
        toggleIngredient('rec_1', 'ing_a');
        expect(getProgress('rec_1').ingredients.has('ing_a')).toBe(true);

        toggleIngredient('rec_1', 'ing_a');
        expect(getProgress('rec_1').ingredients.has('ing_a')).toBe(false);
    });

    it('toggles a step and keeps ingredient state independent', () => {
        toggleIngredient('rec_1', 'ing_a');
        toggleStep('rec_1', 2);

        expect(getProgress('rec_1').steps.has(2)).toBe(true);
        expect(getProgress('rec_1').ingredients.has('ing_a')).toBe(true);
    });

    it('isolates progress between recipes', () => {
        toggleStep('rec_1', 1);

        expect(getProgress('rec_1').steps.has(1)).toBe(true);
        expect(getProgress('rec_2').steps.has(1)).toBe(false);
    });

    it('produces a new snapshot on toggle without mutating the previous one', () => {
        const before = getProgress('rec_1');
        toggleStep('rec_1', 1);
        const after = getProgress('rec_1');

        expect(after).not.toBe(before);
        expect(before.steps.has(1)).toBe(false); // the old snapshot is untouched
        expect(after.steps.has(1)).toBe(true);
    });

    it('notifies subscribers on every mutation and stops after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribe(listener);

        toggleStep('rec_1', 1);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        toggleStep('rec_1', 2);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
