/**
 * MOD-019 IngredientLineParser (FR-020, HAZ-041).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | FR-020 — structured quantity, unit and name from a free-text line | "reads" cases |
 * | FR-020 — the original line is retained verbatim | "raw is retained" cases |
 * | FR-020 — an unparseable line is flagged, never fails the import | "never fabricates" cases |
 * | HAZ-041 — `raw` is retained UNCONDITIONALLY | the raw-retention truth table |
 * | MOD-019 — never a fabricated `1`; never a throw | "never fabricates" + totality |
 *
 * The prohibition under test is the module's whole reason to exist: the destination column is
 * `numeric(10,3) NOT NULL CHECK (quantity > 0)`, which would accept a fabricated `1` without complaint.
 * Every case that cannot read a quantity therefore asserts `quantity === null`, not merely `needsReview`.
 */
import {
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    MAX_RECIPE_INGREDIENT_QUANTITY,
    MIN_RECIPE_INGREDIENT_QUANTITY,
} from '@kitchensink/recipe-core';
import { describe, it, expect } from 'vitest';

import { parseIngredientLine } from '../ingredientLine.js';

describe('parseIngredientLine', () => {
    describe('reads number-WORD lines, which is how the corpus is written', () => {
        it.each([
            ['one tablespoon of butter', 1, 'tablespoon', 'butter'],
            ['two-thirds cup of flour', 0.667, 'cup', 'flour'],
            ['one-half teaspoon salt', 0.5, 'teaspoon', 'salt'],
            ['one and one-half cups of water', 1.5, 'cup', 'water'],
            ['a pinch of salt', 1, 'pinch', 'salt'],
            ['a sprig of thyme', 1, 'sprig', 'thyme'],
            ['twelve grated almonds', 12, null, 'grated almonds'],
            ['three-quarters cup of sugar', 0.75, 'cup', 'sugar'],
            ['one-eighth pound of butter', 0.125, 'lb', 'butter'],
        ])('reads %j', (raw, quantity, unit, name) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toBe(quantity);
            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
            expect(result.needsReview).toBe(false);
        });
    });

    describe('reads numeral lines', () => {
        it.each([
            ['1 1/2 cups sugar', 1.5, 'cup', 'sugar'],
            ['2/3 cup flour', 0.667, 'cup', 'flour'],
            ['3 eggs', 3, null, 'eggs'],
            ['2 tablespoons of brown sugar', 2, 'tablespoon', 'brown sugar'],
        ])('reads %j', (raw, quantity, unit, name) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toBe(quantity);
            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
            expect(result.needsReview).toBe(false);
        });

        it.each([
            ['½ cup milk', 0.5],
            ['¾ teaspoon salt', 0.75],
            ['⅓ cup cream', 0.333],
        ])('reads the unicode vulgar fraction in %j as %d', (raw, quantity) => {
            expect(parseIngredientLine(raw).quantity).toBe(quantity);
        });
    });

    describe('normalizes the unit through recipe-core, so this package holds no second unit vocabulary', () => {
        it.each([
            ['2 cups of flour', 'cup'],
            ['3 tablespoons of vinegar', 'tablespoon'],
            ['2 Tbsp. of vinegar', 'tablespoon'],
            ['1 pound of tenderloin', 'lb'],
            ['4 ounces of butter', 'oz'],
        ])('normalizes the unit in %j to %j', (raw, unit) => {
            expect(parseIngredientLine(raw).unit).toBe(unit);
        });
    });

    describe('never fabricates a quantity', () => {
        it.each([
            ['salt and pepper to taste'],
            ['Boil the sauce and pour over the fish.'],
            ['flour'],
            ['a little water'],
            ['a few slices of lemon'],
            ['sugar to taste'],
        ])('returns a NULL quantity for %j rather than a plausible 1', (raw) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toBeNull();
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('no_quantity');
        });

        it.each([['0 cups water'], ['0 tablespoons sugar']])(
            'rejects the non-positive quantity in %j, which CHECK (quantity > 0) would reject at INSERT',
            (raw) => {
                const result = parseIngredientLine(raw);

                expect(result.quantity).toBeNull();
                expect(result.needsReview).toBe(true);
                expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
            },
        );

        it('rejects a quantity that would round to 0.000 in a numeric(10,3) column', () => {
            const result = parseIngredientLine('0.0004 cup water');

            expect(result.quantity).toBeNull();
            expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
        });

        it('accepts the smallest quantity recipe-core allows', () => {
            const result = parseIngredientLine(`${MIN_RECIPE_INGREDIENT_QUANTITY} cup water`);

            expect(result.quantity).toBe(MIN_RECIPE_INGREDIENT_QUANTITY);
            expect(result.needsReview).toBe(false);
        });

        it('rejects a quantity above the ceiling recipe-core allows, rather than letting the INSERT fail', () => {
            const result = parseIngredientLine(`${MAX_RECIPE_INGREDIENT_QUANTITY + 1} cups water`);

            expect(result.quantity).toBeNull();
            expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
        });
    });

    describe('ranges take the LOWER bound and flag', () => {
        it.each([
            ['2 to 3 cups flour', 2],
            ['1-2 cups flour', 1],
        ])('reads %j as %d and flags it', (raw, quantity) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toBe(quantity);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('quantity_range_narrowed');
        });
    });

    describe('HAZ-041 — raw is retained UNCONDITIONALLY', () => {
        it.each([
            ['one tablespoon of butter'],
            ['salt and pepper to taste'],
            [''],
            ['   '],
            ['For the sauce:'],
            ['<p>not sanitized here</p>'],
            ['0 cups water'],
            ['line one\nline two'],
        ])('returns %j byte-identically', (raw) => {
            expect(parseIngredientLine(raw).raw).toBe(raw);
        });
    });

    describe('the shapes parse-ingredient can return that are NOT a single ingredient', () => {
        it('flags a group header rather than filing it as a broken ingredient', () => {
            const result = parseIngredientLine('For the sauce:');

            expect(result.quantity).toBeNull();
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('group_header');
        });

        it('flags multi-line input rather than silently dropping every line but the first', () => {
            const result = parseIngredientLine('1 cup flour\n2 eggs');

            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('multiline_input');
            expect(result.raw).toBe('1 cup flour\n2 eggs');
        });

        it.each([[''], ['   ']])('flags the empty line %j', (raw) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toBeNull();
            expect(result.name).toBe('');
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('empty_input');
        });

        it('flags a name longer than recipe-core allows, and returns the WHOLE name uncut', () => {
            const longName = 'x'.repeat(MAX_RECIPE_INGREDIENT_NAME_LENGTH + 10);
            const result = parseIngredientLine(`1 cup ${longName}`);

            expect(result.name).toBe(longName);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('name_too_long');
        });
    });

    describe('needsReview is exactly "there is at least one reason"', () => {
        it.each([
            ['one tablespoon of butter'],
            ['salt to taste'],
            [''],
            ['2 to 3 cups flour'],
            ['0 cups water'],
            ['For the sauce:'],
            ['Boil for twenty minutes.'],
        ])('holds for %j', (raw) => {
            const result = parseIngredientLine(raw);
            expect(result.needsReview).toBe(result.reviewReasons.length > 0);
        });
    });

    describe('totality — no input throws, by contract', () => {
        it.each([
            [''],
            ['   '],
            ['\n\n\n'],
            ['-1 cup water'],
            ['1/0 cup water'],
            ['99999999999999999999 cups water'],
            ['NaN cups water'],
            ['Infinity cups water'],
            ['salt \u{1F9C2}'],
            ['a'.repeat(100_000)],
        ])('never throws on %j', (raw) => {
            expect(() => parseIngredientLine(raw)).not.toThrow();
        });

        it('never returns a quantity outside the window recipe-core can store', () => {
            const adversarial = [
                '',
                '-1 cup water',
                '0 cup water',
                '1/0 cup water',
                '99999999999999999999 cups water',
                'NaN cups water',
                '0.0000001 cup water',
                'salt to taste',
            ];

            for (const raw of adversarial) {
                const { quantity } = parseIngredientLine(raw);

                if (quantity !== null) {
                    expect(quantity).toBeGreaterThanOrEqual(MIN_RECIPE_INGREDIENT_QUANTITY);
                    expect(quantity).toBeLessThanOrEqual(MAX_RECIPE_INGREDIENT_QUANTITY);
                }
            }
        });
    });
});
