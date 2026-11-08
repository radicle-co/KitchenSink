/**
 * The one place a card's calorie slot is built from a batch lookup. It was written out at six call sites (web's
 * hydration gate, the Home widget, the collection body, mobile's list screen and discovery platform); this pins the
 * shared rule they all leaned on: the slot gets the reading of the batch that covers the recipe, and a recipe no batch
 * covers renders NOTHING (never a slot with no reading to settle: a skeleton for the life of the page).
 *
 * REWRITTEN for ADR-0079: the lookup answers a batch READING, where it used to answer a promise.
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipeNutritionSlot } from '../RecipeNutritionSlot.js';
import type { RecipeNutritionBatchReading } from '../model.js';
import { nutritionSlotRenderer } from '../nutritionSlotRenderer.js';

describe('nutritionSlotRenderer', () => {
    it('builds the slot from the reading the lookup returns for THAT recipe', () => {
        const batchA: RecipeNutritionBatchReading = { status: 'settled', response: { nutrition: {} } };
        const batchB: RecipeNutritionBatchReading = { status: 'pending' };
        const render = nutritionSlotRenderer((id) => (id === 'a' ? batchA : batchB));

        expect(render('a')).toMatchObject({
            type: RecipeNutritionSlot,
            props: { recipeId: 'a', reading: batchA },
        });
        expect(render('b')).toMatchObject({
            type: RecipeNutritionSlot,
            props: { recipeId: 'b', reading: batchB },
        });
    });

    it('renders nothing for a recipe no batch covers', () => {
        expect(nutritionSlotRenderer(() => null)('a')).toBeNull();
    });

    it('asks the lookup once per call, with the recipe id', () => {
        const lookup = vi.fn(() => null);

        void nutritionSlotRenderer(lookup)('x');

        expect(lookup).toHaveBeenCalledExactlyOnceWith('x');
    });
});
