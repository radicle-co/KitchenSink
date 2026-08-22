/**
 * MOD-019 IngredientLineParser (FR-020, HAZ-041) — and U7's value-corruption fixes (R29–R31, R36, R39).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | FR-020 — structured quantity, unit and name from a free-text line | "reads" cases |
 * | FR-020 — the original line is retained verbatim | "raw is retained" cases |
 * | FR-020 — an unparseable line is flagged, never fails the import | "never fabricates" cases |
 * | HAZ-041 — `raw` is retained UNCONDITIONALLY | the raw-retention truth table |
 * | MOD-019 — never a fabricated `1`; never a throw | "never fabricates" + totality |
 * | R30 — `½` precedence matches its documented contract, both directions | the vulgar-fraction suite |
 * | R31 — the unit table covers the `*ful` family | the unit-normalization suite |
 * | R36 — a stated range preserves BOTH bounds | the range suite |
 * | R39 — a caller can name which reasons corrupt a stated value | `corruptsStatedValue` |
 * | R39 — a value-corrupting review reason is nameable by a caller | `corruptsStatedValue` |
 *
 * The prohibition under test is the module's whole reason to exist: the destination column would accept a
 * fabricated `1` without complaint. Every case that cannot read a quantity therefore asserts
 * `kind: 'absent'`, not merely `needsReview`.
 *
 * ⚠️ **These cases were REWRITTEN for U7, not edited to compile.** `quantity` was `number | null`; it is
 * now the `IngredientQuantity` value object (KTD-6), because `number | null` cannot express the upper
 * bound of `2 to 3 cups` and cannot distinguish "the source stated none" from "we read a zero". Two
 * previously-green expectations are now assertions of the OPPOSITE value, and each says so at its case:
 * `1½ cups` (was 1 — a silent one-third under-statement) and `2 to 3 cups` (was 2, upper bound dropped).
 */
import {
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    MAX_RECIPE_INGREDIENT_QUANTITY,
    MIN_RECIPE_INGREDIENT_QUANTITY,
} from '@kitchensink/recipe-core';
import { ABSENT_QUANTITY, statedQuantity } from '@kitchensink/recipe-core';
import { describe, it, expect } from 'vitest';

import { corruptsStatedValue, parseIngredientLine, type IngredientReviewReason } from '../ingredientLine.js';

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

            expect(result.quantity).toEqual(statedQuantity(quantity));
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

            expect(result.quantity).toEqual(statedQuantity(quantity));
            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
            expect(result.needsReview).toBe(false);
        });
    });

    /**
     * R30 — the `½` precedence contract, asserted in BOTH directions.
     *
     * ⛔ `1½ cups of sugar` returned **1** before U7 — the leading numeral won the `??` and the fraction
     * was discarded, silently understating a stated quantity by a third, with `needsReview: false`. The
     * other direction is the reason the precedence exists at all: `parse-ingredient` TRUNCATES a numeral
     * at six digits, so a line whose quantity this module can read must never be handed to it.
     */
    describe('unicode vulgar fractions (R30)', () => {
        it.each([
            ['½ cup milk', 0.5, 'cup', 'milk'],
            ['¾ teaspoon salt', 0.75, 'teaspoon', 'salt'],
            ['⅓ cup cream', 0.333, 'cup', 'cream'],
            ['⅛ pound butter', 0.125, 'lb', 'butter'],
        ])('reads the bare vulgar fraction in %j as %d', (raw, quantity, unit, name) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toEqual(statedQuantity(quantity));
            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
        });

        it.each([
            ['1½ cups of sugar', 1.5],
            ['2½ cups flour', 2.5],
            ['1 ½ cups of sugar', 1.5],
            ['3⅓ cups milk', 3.333],
        ])('reads the MIXED numeral in %j as %d rather than dropping the fraction', (raw, quantity) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toEqual(statedQuantity(quantity));
            expect(result.needsReview).toBe(false);
        });

        it('still refuses to hand a long numeral to parse-ingredient, which truncates it at six digits', () => {
            // `parse-ingredient@2.2.0` returns 100000 for this line — a plausible wrong number INSIDE the
            // storable window. The precedence that produces the `1½` bug is also what stops that one, so
            // the fix must keep this direction green.
            const result = parseIngredientLine('1000001 cups water');

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
            expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
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

        /**
         * R31 — the `*ful` family. `teaspoonful` was returned VERBATIM as the unit before U7, so it
         * matched no portion and the line lost its gram conversion.
         */
        it.each([
            ['a teaspoonful of salt', 'teaspoon', 'salt'],
            ['two teaspoonfuls of vanilla', 'teaspoon', 'vanilla'],
            ['a tablespoonful of butter', 'tablespoon', 'butter'],
            ['two tablespoonfuls of flour', 'tablespoon', 'flour'],
            ['a cupful of milk', 'cup', 'milk'],
        ])('reads the *ful unit in %j as %j', (raw, unit, name) => {
            const result = parseIngredientLine(raw);

            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
            expect(result.needsReview).toBe(false);
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
        ])('returns an ABSENT quantity for %j rather than a plausible 1', (raw) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('no_quantity');
        });

        it.each([['0 cups water'], ['0 tablespoons sugar']])(
            'rejects the non-positive quantity in %j, which CHECK (quantity > 0) would reject at INSERT',
            (raw) => {
                const result = parseIngredientLine(raw);

                expect(result.quantity).toEqual(ABSENT_QUANTITY);
                expect(result.needsReview).toBe(true);
                expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
            },
        );

        it('rejects a quantity that would round to 0.000 in a numeric(10,3) column', () => {
            const result = parseIngredientLine('0.0004 cup water');

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
            expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
        });

        it('accepts the smallest quantity recipe-core allows', () => {
            const result = parseIngredientLine(`${MIN_RECIPE_INGREDIENT_QUANTITY} cup water`);

            expect(result.quantity).toEqual(statedQuantity(MIN_RECIPE_INGREDIENT_QUANTITY));
            expect(result.needsReview).toBe(false);
        });

        it('rejects a quantity above the ceiling recipe-core allows, rather than letting the INSERT fail', () => {
            const result = parseIngredientLine(`${MAX_RECIPE_INGREDIENT_QUANTITY + 1} cups water`);

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
            expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
        });
    });

    /**
     * R36 — a stated range preserves BOTH bounds.
     *
     * ⛔ Before U7 every case here returned the LOWER bound alone and flagged `quantity_range_narrowed`.
     * The upper bound was available on `parse-ingredient`'s `quantity2` and discarded at one line, so a
     * recipe calling for up to 3 cups was persisted as calling for 2 — a third less flour, published.
     */
    describe('ranges keep both bounds (R36)', () => {
        it.each([
            ['2 to 3 cups flour', 2, 3, 'cup', 'flour'],
            ['1-2 cups flour', 1, 2, 'cup', 'flour'],
            ['2 or 3 tablespoons sugar', 2, 3, 'tablespoon', 'sugar'],
            ['1 1/2 to 2 cups milk', 1.5, 2, 'cup', 'milk'],
        ])('reads %j as %d to %d', (raw, low, high, unit, name) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toEqual(statedQuantity(low, high));
            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
            expect(result.needsReview).toBe(false);
        });

        /**
         * The corpus is written in number WORDS, so a range fix that only reads numerals fixes nothing
         * for the book this import exists to read. `three or four potatoes` occurs verbatim in the
         * committed cookbook excerpt.
         */
        it.each([
            ['two to three cups of flour', 2, 3, 'cup', 'flour'],
            ['three or four potatoes', 3, 4, null, 'potatoes'],
            ['one to two teaspoons of salt', 1, 2, 'teaspoon', 'salt'],
            ['one-half to three-quarters cup of sugar', 0.5, 0.75, 'cup', 'sugar'],
        ])('reads the WORD-form range in %j as %d to %d', (raw, low, high, unit, name) => {
            const result = parseIngredientLine(raw);

            expect(result.quantity).toEqual(statedQuantity(low, high));
            expect(result.unit).toBe(unit);
            expect(result.name).toBe(name);
        });

        it('is not fooled by a separator word that does not introduce a second quantity', () => {
            const result = parseIngredientLine('one teaspoon or more of vanilla');

            expect(result.quantity).toEqual(statedQuantity(1));
            expect(result.unit).toBe('teaspoon');
        });

        /**
         * ⛔ NOT narrowed to the storable bound. Keeping `2` out of `"2 to 1000001 cups"` publishes a
         * number the source states only half of, and a wrong number in a public recipe's nutrition costs
         * more than a missing ingredient. The whole line goes to review instead.
         */
        it('refuses the WHOLE line when either bound is not storable, rather than narrowing to the other', () => {
            const result = parseIngredientLine(`2 to ${MAX_RECIPE_INGREDIENT_QUANTITY + 1} cups water`);

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('quantity_out_of_storage_range');
        });

        it('refuses an inverted range rather than persisting bounds that disagree', () => {
            const result = parseIngredientLine('3 to 2 cups flour');

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('quantity_bounds_inverted');
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
            ['1½ cups of sugar'],
            ['2 to 3 cups flour'],
        ])('returns %j byte-identically', (raw) => {
            expect(parseIngredientLine(raw).raw).toBe(raw);
        });
    });

    describe('the shapes parse-ingredient can return that are NOT a single ingredient', () => {
        it('flags a group header rather than filing it as a broken ingredient', () => {
            const result = parseIngredientLine('For the sauce:');

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
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

            expect(result.quantity).toEqual(ABSENT_QUANTITY);
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
            ['1½ cups of sugar'],
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
            ['½'],
            ['1½'],
            ['to to to'],
            ['2 to'],
            ['2 to to 3 cups'],
            ['a'.repeat(100_000)],
        ])('never throws on %j', (raw) => {
            expect(() => parseIngredientLine(raw)).not.toThrow();
        });

        it('never returns a bound outside the window recipe-core can store', () => {
            const adversarial = [
                '',
                '-1 cup water',
                '0 cup water',
                '1/0 cup water',
                '99999999999999999999 cups water',
                'NaN cups water',
                '0.0000001 cup water',
                'salt to taste',
                '2 to 99999999999999999999 cups water',
                '1½ cups water',
            ];

            for (const raw of adversarial) {
                const { quantity } = parseIngredientLine(raw);

                if (quantity.kind === 'absent') {
                    continue;
                }

                const bounds = quantity.kind === 'exact' ? [quantity.value] : [quantity.low, quantity.high];

                for (const bound of bounds) {
                    expect(bound).toBeGreaterThanOrEqual(MIN_RECIPE_INGREDIENT_QUANTITY);
                    expect(bound).toBeLessThanOrEqual(MAX_RECIPE_INGREDIENT_QUANTITY);
                }
            }
        });
    });
});

/**
 * R39 — the caller that decides whether to persist a line needs to know which reasons mean "the number
 * we are about to write is not the number the source stated". A boolean `needsReview` cannot say that,
 * and a caller re-deriving the list would be a second representation of this module's own taxonomy.
 */
describe('corruptsStatedValue', () => {
    it.each([['quantity_out_of_storage_range'], ['quantity_bounds_inverted']] as const)(
        'reports %j as value-corrupting, because a stated number was dropped or disagrees',
        (reason) => {
            expect(corruptsStatedValue(reason)).toBe(true);
        },
    );

    it.each([['empty_input'], ['no_quantity'], ['group_header'], ['multiline_input'], ['name_too_long']] as const)(
        'reports %j as NOT value-corrupting, because it names an absence, not a wrong number',
        (reason) => {
            expect(corruptsStatedValue(reason)).toBe(false);
        },
    );

    it('is total over the reason union, so a new reason cannot default to "harmless"', () => {
        const everyReason: readonly IngredientReviewReason[] = [
            'empty_input',
            'no_quantity',
            'quantity_out_of_storage_range',
            'quantity_bounds_inverted',
            'group_header',
            'multiline_input',
            'name_too_long',
        ];

        for (const reason of everyReason) {
            expect(typeof corruptsStatedValue(reason)).toBe('boolean');
        }
    });
});
