/**
 * Unit tests for {@link nutritionFreshness} — whether a nutrition READING rests on food data served stale.
 *
 * ## ⛔ Stale is a fact about the lines that COUNTED, not about the foods that were LOOKED UP
 *
 * The rule this replaces asked "did the recipe reference any stale food, and did any line use catalog data?"
 * — two questions about the whole recipe, joined. That marks a reading stale when the stale food sits behind a
 * line that contributed nothing from the catalog (a withheld line, a line carrying the cook's own numbers, a
 * unit the catalog cannot convert) while a DIFFERENT, fresh catalog line supplied the figure: a caveat about
 * data the reading does not contain. So the question is asked per line — a line is stale only when its catalog
 * figure is what accounted for it AND that figure was served from cache.
 */
import { describe, expect, it } from 'vitest';

import { statedQuantity, type IngredientQuantity } from '../ingredientQuantity.js';
import { nutritionFreshness, toNutritionLine, type NutritionLine } from '../nutrition.js';
import { recipeDetailNutritionSchema } from '../recipe.types.js';

/** A quantity the source stated exactly. */
function exact(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

const FLOUR_PER_100G = { caloriesPer100g: 364, proteinGPer100g: 10, carbsGPer100g: 76, fatGPer100g: 1 };

/** A catalog line measured in grams — always convertible, so its catalog figure accounts for it. */
function catalogLine(catalogFreshness: 'fresh' | 'stale'): NutritionLine {
    return { quantity: exact(100), unit: 'g', ...FLOUR_PER_100G, catalogFreshness };
}

describe('toNutritionLine', () => {
    it('carries the catalog entry’s freshness onto the line, so the rule can be asked per line', () => {
        const line = toNutritionLine({ quantity: exact(100), unit: 'g' }, { ...FLOUR_PER_100G, freshness: 'stale' });

        expect(line.catalogFreshness).toBe('stale');
    });

    it('omits it when the line has no catalog entry — absence, not a fabricated "fresh"', () => {
        const line = toNutritionLine({ quantity: exact(100), unit: 'g' }, undefined);

        expect('catalogFreshness' in line).toBe(false);
    });
});

describe('nutritionFreshness', () => {
    it('no lines → fresh (nothing could have gone stale)', () => {
        expect(nutritionFreshness([])).toBe('fresh');
    });

    it('a stale catalog line that ACCOUNTS for itself → stale', () => {
        expect(nutritionFreshness([catalogLine('stale')])).toBe('stale');
    });

    it('a fresh catalog line → fresh', () => {
        expect(nutritionFreshness([catalogLine('fresh')])).toBe('fresh');
    });

    it('⛔ a stale food behind the cook’s OWN numbers → fresh: the override accounted for the line', () => {
        const overridden: NutritionLine = { ...catalogLine('stale'), userCalories: 120 };

        expect(nutritionFreshness([overridden])).toBe('fresh');
    });

    it('⛔ a stale catalog line whose unit cannot be converted → fresh: it contributed no catalog figure', () => {
        const unconvertible: NutritionLine = { ...catalogLine('stale'), quantity: exact(2), unit: 'handful' };

        expect(nutritionFreshness([unconvertible])).toBe('fresh');
    });

    it('⛔ a fresh catalog line beside a stale food that contributed no figure → fresh (the over-marking fixed)', () => {
        const noFigure: NutritionLine = { ...catalogLine('stale'), quantity: exact(2), unit: 'handful' };

        expect(nutritionFreshness([catalogLine('fresh'), noFigure])).toBe('fresh');
    });

    it('a line with no catalog entry (what a WITHHELD line is given) carries no marker, so it cannot age the reading', () => {
        const withheld = toNutritionLine({ quantity: exact(100), unit: 'g' }, undefined);

        expect(nutritionFreshness([catalogLine('fresh'), withheld])).toBe('fresh');
    });

    it('one stale contributing line among fresh ones → stale', () => {
        expect(nutritionFreshness([catalogLine('fresh'), catalogLine('stale')])).toBe('stale');
    });
});

describe('recipeDetailNutritionSchema', () => {
    const reading = { calories: 520, proteinG: 32, carbsG: 18, fatG: 34, isComplete: true };

    it('REQUIRES freshness — an absent marker would read as current, which is the defect it exists to close', () => {
        expect(recipeDetailNutritionSchema.safeParse(reading).success).toBe(false);
    });

    it('keeps freshness on parse (the base schema is non-strict and would silently strip an unknown key)', () => {
        expect(recipeDetailNutritionSchema.parse({ ...reading, freshness: 'stale' }).freshness).toBe('stale');
    });

    it('refuses a freshness outside the vocabulary', () => {
        expect(recipeDetailNutritionSchema.safeParse({ ...reading, freshness: 'old' }).success).toBe(false);
    });
});
