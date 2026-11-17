/**
 * The scoring the facts-sheet corpus script uses, on made-up sheets: what counts as a wrong fact, how recall is
 * worked out, and when the recall floor is broken or raised. The corpus itself never enters the repository.
 */
import type { FactsSheet } from '@kitchensink/recipe-core/step-writing/facts-sheet-types';
import { describe, expect, it } from 'vitest';

import {
    type Floor,
    type GoldenRecipe,
    floorFaults,
    factsOf,
    ingredientNameOf,
    precisionFaults,
    raisedFloor,
    recallOf,
} from '../factsCorpusScore.js';

const sheet: FactsSheet = {
    language: 'en',
    ingredientNames: ['butter'],
    steps: [
        {
            actions: ['melt'],
            ingredients: ['butter'],
            equipment: [],
            amounts: [{ quantity: 2, unit: 'tbsp', ingredient: 'butter' }],
            temperatures: [{ value: 200, scale: 'C' }],
            durations: [{ minSeconds: 60, maxSeconds: 90 }],
            safety: [{ category: 'internalTemperature', facts: ['74 C'] }],
        },
    ],
};

const golden = (over: Partial<GoldenRecipe> = {}): GoldenRecipe => ({
    actions: ['0:melt'],
    ingredients: ['0:butter'],
    amounts: ['0:2|tbsp|butter'],
    temperatures: ['0:200C'],
    durations: ['0:60-90'],
    safety: ['0:internalTemperature:74 C'],
    ...over,
});

describe('factsOf', () => {
    it('names each fact by its step and its content', () => {
        expect(factsOf(sheet)).toEqual({
            actions: ['0:melt'],
            ingredients: ['0:butter'],
            amounts: ['0:2|tbsp|butter'],
            temperatures: ['0:200C'],
            durations: ['0:60-90'],
            safety: ['0:internalTemperature:74 C'],
        });
    });
});

describe('precisionFaults', () => {
    it('is empty when every stated fact is in the golden entry', () => {
        expect(precisionFaults('r', sheet, golden())).toEqual([]);
    });

    it('names a stated fact the golden entry does not hold', () => {
        expect(precisionFaults('r', sheet, golden({ amounts: [] }))).toEqual(['r amounts 0:2|tbsp|butter']);
    });

    it('does not fault a golden fact the sheet did not state, which is recall and not precision', () => {
        expect(precisionFaults('r', sheet, golden({ actions: ['0:melt', '0:stir'] }))).toEqual([]);
    });

    it('holds a refusal to the golden refusal, both ways', () => {
        expect(precisionFaults('r', { refused: 'steps[0].amounts' }, golden({ refused: 'steps[0].amounts' }))).toEqual(
            [],
        );
        expect(precisionFaults('r', { refused: 'steps[1].amounts' }, golden({ refused: 'steps[0].amounts' }))).toEqual([
            'r: refused at steps[1].amounts, golden says steps[0].amounts',
        ]);
        expect(precisionFaults('r', { refused: 'steps[0].amounts' }, golden())).toEqual([
            'r: refused at steps[0].amounts, golden says not refused',
        ]);
        expect(precisionFaults('r', sheet, golden({ refused: 'steps[0].amounts' }))).toEqual([
            'r: refused at not refused, golden says steps[0].amounts',
        ]);
    });
});

describe('recallOf', () => {
    it('is the share of golden facts found, per kind, and 1 for a kind with none', () => {
        const recall = recallOf([
            { outcome: sheet, expected: golden({ actions: ['0:melt', '0:stir'], safety: [] }) },
            { outcome: { refused: 'x' }, expected: golden() },
            { outcome: sheet, expected: golden({ refused: 'x' }) },
        ]);

        expect(recall.actions).toBeCloseTo(0.5);
        expect(recall.amounts).toBe(1);
        expect(recall.safety).toBe(1);
    });
});

describe('floorFaults and raisedFloor', () => {
    const floor: Floor = {
        recall: { actions: 1, ingredients: 1, amounts: 0.9, temperatures: 1, durations: 1, safety: 1 },
        refusedMax: 2,
    };
    const recall = { ...floor.recall };

    it('passes at the floor', () => {
        expect(floorFaults(recall, 2, floor)).toEqual([]);
    });

    it('names a kind that fell below its floor, and too many refusals', () => {
        expect(floorFaults({ ...recall, amounts: 0.8 }, 3, floor)).toEqual([
            'recall of amounts is 0.8, below the floor 0.9',
            'recipes refused: 3, more than the ceiling 2',
        ]);
    });

    it('raises a floor and lowers the ceiling, and never the other way', () => {
        expect(raisedFloor({ ...recall, amounts: 0.95, actions: 0.5 }, 1, floor)).toEqual({
            recall: { ...floor.recall, amounts: 0.95 },
            refusedMax: 1,
        });
        expect(raisedFloor(recall, 5, floor).refusedMax).toBe(2);
    });
});

describe('ingredientNameOf', () => {
    it.each([
        ['2 cups all-purpose flour, sifted', 'all-purpose flour'],
        ['1 (14 oz) can diced tomatoes', 'diced tomatoes'],
        ['1/2 cup of the sugar', 'the sugar'],
        ['salt', 'salt'],
    ])('keeps the food words of %s', (line, name) => {
        expect(ingredientNameOf(line)).toBe(name);
    });
});
