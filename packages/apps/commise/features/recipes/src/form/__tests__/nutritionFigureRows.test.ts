/**
 * Unit tests for `nutritionFigureRows` — the ONE formatting of a panel's figures, shared by both platform leaves so
 * they cannot show a figure differently.
 */
import { describe, expect, it } from 'vitest';

import { recipeFormMessages } from '../messages.js';
import { nutritionFigureRows } from '../nutritionFigureRows.js';

const m = recipeFormMessages.en;

describe('nutritionFigureRows', () => {
    it('labels each figure, rounds calories, and gives grams one decimal place', () => {
        expect(nutritionFigureRows({ calories: 130.4, proteinG: 2.66, carbsG: 28, fatG: 0.3 }, m, 'en', true)).toEqual([
            { label: m.nutritionCaloriesLabel, value: '130' },
            { label: m.nutritionProteinLabel, value: '2.7 g' },
            { label: m.nutritionCarbsLabel, value: '28 g' },
            { label: m.nutritionFatLabel, value: '0.3 g' },
        ]);
    });

    it('⛔ an unpublished figure is an em dash, never 0 — and an honest 0 stays 0', () => {
        expect(nutritionFigureRows({ calories: 0 }, m, 'en', true)).toEqual([
            { label: m.nutritionCaloriesLabel, value: '0' },
            { label: m.nutritionProteinLabel, value: '—' },
            { label: m.nutritionCarbsLabel, value: '—' },
            { label: m.nutritionFatLabel, value: '—' },
        ]);
    });

    it('lists only the stated figures when a missing one is not food’s to publish (the cook’s own)', () => {
        expect(nutritionFigureRows({ proteinG: 1 }, m, 'en', false)).toEqual([
            { label: m.nutritionProteinLabel, value: '1 g' },
        ]);
    });
});
