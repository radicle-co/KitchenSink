/**
 * `foodEditComparison` (spec D4): state 9 lists only the fields the waiting edit changes, as "from to" pairs, over the
 * public version the page shows. Nothing else is listed, so an unchanged field never appears.
 */
import type { FoodResponse, PublicationSnapshot } from '@kitchensink/schema-food';
import { describe, expect, it } from 'vitest';

import { foodEditComparison, macrosOfFood } from '../foodEditComparison.js';

const nutrient = (nutrient: string, amount: number, unit: string) => ({
    nutrient,
    amount,
    unit,
    basis: 'per_100g',
    source: 'authored',
});
const FOOD: FoodResponse = {
    id: 'f1',
    name: 'Oat milk',
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [
        nutrient('Energy', 120, 'kcal'),
        nutrient('Protein', 3, 'g'),
        nutrient('Carbohydrate, by difference', 16, 'g'),
        nutrient('Total lipid (fat)', 5, 'g'),
    ],
    portions: [],
    provenance: {},
    variants: [],
};
const SNAPSHOT: PublicationSnapshot = {
    name: 'Oat milk',
    description: null,
    macros: { calories: 120, proteinG: 3, carbsG: 16, fatG: 5 },
    portions: [],
};

describe('macrosOfFood', () => {
    it('reads the four per-100 g figures out of the food’s nutrient rows, whatever the dictionary calls them', () => {
        expect(macrosOfFood(FOOD)).toEqual({ calories: 120, proteinG: 3, carbsG: 16, fatG: 5 });
    });

    it('does not take kJ for calories', () => {
        const food = { ...FOOD, nutrients: [nutrient('Energy', 500, 'kJ'), nutrient('Energy', 120, 'kcal')] };

        expect(macrosOfFood(food).calories).toBe(120);
    });
});

describe('foodEditComparison', () => {
    it('is empty when the edit changes nothing', () => {
        expect(foodEditComparison(FOOD, SNAPSHOT)).toEqual([]);
    });

    it('lists only the changed fields, public value first', () => {
        const rows = foodEditComparison(FOOD, { ...SNAPSHOT, macros: { ...SNAPSHOT.macros, calories: 135 } });

        expect(rows).toEqual([{ field: 'calories', from: '120', to: '135', unit: 'kcal' }]);
    });

    it('lists a rename as a Name row', () => {
        const rows = foodEditComparison(FOOD, { ...SNAPSHOT, name: 'Oat drink' });

        expect(rows).toEqual([{ field: 'name', from: 'Oat milk', to: 'Oat drink', unit: null }]);
    });

    it('lists several changes in a fixed order: name, calories, protein, carbs, fat', () => {
        const rows = foodEditComparison(FOOD, {
            ...SNAPSHOT,
            name: 'X',
            macros: { calories: 1, proteinG: 4, carbsG: 17, fatG: 6 },
        });

        expect(rows.map((row) => row.field)).toEqual(['name', 'calories', 'proteinG', 'carbsG', 'fatG']);
    });

    it('shows a figure with its decimals only when it has some', () => {
        const rows = foodEditComparison(FOOD, { ...SNAPSHOT, macros: { ...SNAPSHOT.macros, proteinG: 3.5 } });

        expect(rows[0]).toMatchObject({ from: '3', to: '3.5' });
    });
});
