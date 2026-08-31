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

        /**
         * U35 — capital `T` is a tablespoon, lowercase `t` is a teaspoon (owner ruling, 2026-08-25).
         *
         * ⛔ THIS IS THE ASSERTION THAT CATCHES AN UPSTREAM LOWERCASE, and it is why the case lives here
         * rather than only in `recipe-core`'s own suite. A fix confined to `normalizeUnit` is worthless if
         * `parse-ingredient` has already folded the case away before we ever see the token: the unit test
         * would pass and the pipeline would still store `t` for both spellings.
         *
         * Measured 2026-08-25 against `parse-ingredient@2.2.0`: it PRESERVES the case — `"2 T butter"`
         * yields `unitOfMeasure: 'T'` and `"2 t vanilla"` yields `unitOfMeasure: 't'` — so the token
         * reaches `normalizeUnit` intact and the ruling is implementable at this seam. These cases pin
         * that, so a library upgrade that started lower-casing would fail HERE rather than silently.
         */
        describe('U35 — the case-sensitive pair, end to end through the real parser', () => {
            it.each([
                ['2 T butter', 'tablespoon', 'butter'],
                ['2 t vanilla', 'teaspoon', 'vanilla'],
                ['1 T olive oil', 'tablespoon', 'olive oil'],
                ['1 t salt', 'teaspoon', 'salt'],
            ])('reads %j as %j of %j', (raw, unit, name) => {
                const result = parseIngredientLine(raw);

                expect(result.quantity).toEqual({ kind: 'exact', value: raw.startsWith('2') ? 2 : 1 });
                expect(result.unit).toBe(unit);
                expect(result.name).toBe(name);
                expect(result.needsReview).toBe(false);
            });

            it('keeps the two APART through the whole pipeline — conflating them IS the defect', () => {
                expect(parseIngredientLine('2 T butter').unit).not.toBe(parseIngredientLine('2 t vanilla').unit);
            });

            it('never reads a lowercase t as a tablespoon — the 3x error in the other direction', () => {
                expect(parseIngredientLine('2 t vanilla').unit).not.toBe('tablespoon');
            });

            it.each([
                ['2 tbsp butter', 'tablespoon'],
                ['2 Tbsp. butter', 'tablespoon'],
                ['2 TBSP butter', 'tablespoon'],
                ['2 tsp vanilla', 'teaspoon'],
                ['2 Cups flour', 'cup'],
            ])('leaves every OTHER spelling case-insensitive: %j still reads as %j', (raw, unit) => {
                expect(parseIngredientLine(raw).unit).toBe(unit);
            });
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
/**
 * ⛔ THE DECISION TABLE, and why it replaced a hand-written list.
 *
 * This suite carried an `everyReason` ARRAY that was supposed to keep `corruptsStatedValue` total over the
 * union. It could not: an array of string literals is assignable to `readonly IngredientReviewReason[]`
 * whether or not it is exhaustive, so the list silently rotted — `measurement_in_name` and
 * `additional_foods_dropped` were both added to the union and neither was ever added here. The old
 * assertion was vacuous besides (`typeof … === 'boolean'` is true for both answers), so the list proved
 * nothing even for the reasons it did name.
 *
 * `satisfies Record<IngredientReviewReason, boolean>` is the repair, and it is a COMPILE error rather than
 * a runtime one: adding a member to the union without deciding it here fails `npm run typecheck`, which CI
 * runs. The value is the EXPECTED answer, so the decision is explicit and the assertion is non-vacuous.
 */
const CORRUPTS_STATED_VALUE = {
    empty_input: false,
    no_quantity: false,
    quantity_out_of_storage_range: true,
    quantity_bounds_inverted: true,
    group_header: false,
    multiline_input: false,
    name_too_long: false,
    measurement_in_name: false,
    additional_foods_dropped: false,
    // ⛔ U22a. The amount and unit reported are exactly what the source stated for the food that was kept;
    // what was dropped is a vessel, a duration or a target. Membership would make `cookbook-import`
    // discard a whole line it can read — `additional_foods_dropped`'s argument, verbatim.
    instruction_text_dropped: false,
    // U7: the validator's terminal not-a-food is an absence record — no stated number was altered.
    not_a_food: false,
} as const satisfies Record<IngredientReviewReason, boolean>;

describe('corruptsStatedValue', () => {
    it.each(Object.entries(CORRUPTS_STATED_VALUE))(
        'classifies %j as value-corrupting: %j — the decision, not a default',
        (reason, corrupting) => {
            expect(corruptsStatedValue(reason as IngredientReviewReason)).toBe(corrupting);
        },
    );

    /**
     * Anti-vacuity. `it.each` over an empty or truncated table would report zero failures and look green,
     * which is how the list this replaced rotted unnoticed. The count is asserted so a table that stops
     * covering the union fails loudly rather than quietly.
     */
    it('decides every reason in the union, and both answers actually occur', () => {
        const decisions = Object.values(CORRUPTS_STATED_VALUE);

        expect(decisions.length).toBeGreaterThanOrEqual(10);
        expect(decisions).toContain(true);
        expect(decisions).toContain(false);
    });
});

/**
 * ⛔ A MEASUREMENT LEFT INSIDE THE FOOD NAME (raised 2026-08-23).
 *
 * `parse-ingredient` reads the LEADING quantity and treats the remainder as the food, so a line stating more
 * than one measurement puts the rest into `name` — measured before this fix, "2 cups and 1 tablespoon
 * all-purpose flour, sifted" produced `name: "and 1 tablespoon all-purpose flour, sifted"` with
 * `reviewReasons: []`.
 *
 * Both halves of that are defects. A name carrying a measurement matches no catalog row, so the line resolves
 * to nothing or to something wrong; and an empty review reason means nobody is asked to correct it either.
 *
 * ⚠️ The two shapes need OPPOSITE treatment, which is why `splitMeasurement` decides and this does not:
 *
 *  - a conjunction ADDS, so the quantity we persist UNDERSTATES the line — that is value-corrupting.
 *  - a parenthetical RESTATES, so the quantity is already right — the text is merely not part of the name.
 *
 * Treating the second as the first would flag every "(about 4 cups)" as a wrong number; treating the first as
 * the second would silently persist a fifth of the flour.
 */
describe('parseIngredientLine — a measurement left in the food name', () => {
    it('takes the restatement out of the name without touching the quantity', () => {
        const parsed = parseIngredientLine('1 pound (about 4 cups) shredded cooked chicken');

        expect(parsed.name).toBe('shredded cooked chicken');
        expect(parsed.quantity).toEqual({ kind: 'exact', value: 1 });
        expect(parsed.unit).toBe('lb');
        // The amount is stated twice and read once, which is correct — nothing to review.
        expect(parsed.reviewReasons).not.toContain('measurement_in_name');
    });

    it('takes an added measurement out of the name AND says the quantity understates the line', () => {
        const parsed = parseIngredientLine('2 cups and 1 tablespoon all-purpose flour, sifted');

        expect(parsed.name).toBe('all-purpose flour, sifted');
        expect(parsed.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(parsed.unit).toBe('cup');
        expect(parsed.reviewReasons).toContain('measurement_in_name');
    });

    /**
     * ⛔ REWRITTEN, and it asserts the OPPOSITE of what it first did. I had this reason as value-corrupting,
     * on the argument that persisting 2 cups for "2 cups and 1 tablespoon" asserts a number the source did
     * not state. `cookbook-import`'s own suite refuted it: `proseRecipe.ts` DROPS a clause whose reading
     * corrupts a value, so membership discarded the ingredient outright and a golden-corpus recipe lost its
     * confectioner's sugar entirely.
     *
     * The set's docstring already drew the line — membership is "a stated number would be wrong", not
     * "something is missing". Reading 2 cups reads a real amount and stops short of the rest, which is the
     * shape of `no_quantity`, also absent from that set. Losing 100% of a line to avoid understating it by
     * 3% is the wrong trade.
     */
    it('does not treat a short reading as a wrong number, so the ingredient survives', () => {
        expect(corruptsStatedValue('measurement_in_name')).toBe(false);
    });

    it('leaves an ordinary line entirely alone', () => {
        const parsed = parseIngredientLine('1 to 2 teaspoons kosher salt');

        expect(parsed.name).toBe('kosher salt');
        expect(parsed.quantity).toEqual({ kind: 'range', low: 1, high: 2 });
        expect(parsed.reviewReasons).not.toContain('measurement_in_name');
    });

    /**
     * ⛔ THE GENERAL RULE, and the reason the join list may stay short: an amount FOLLOWED BY A UNIT is a
     * measurement, wherever it sits and however the line joined it on. None of these joins appears anywhere
     * in the module.
     *
     * ⚠️ An earlier check asked instead whether anything word-like preceded the amount. Measured against
     * exactly these eight, it caught THREE — every word-shaped join defeated it, because the join's own
     * letters read as the food. It was a second enumeration, of punctuation, wearing a general rule's
     * clothes. This case list is what refuted it and is kept for that reason.
     */
    it.each([
        ['a word join nothing here lists', '2 cups with 1 tablespoon all-purpose flour'],
        ['a multi-word join', '2 cups as well as 1 tablespoon all-purpose flour'],
        ['an em dash', '2 cups — 1 tablespoon all-purpose flour'],
        ['a semicolon', '2 cups; 1 tablespoon all-purpose flour'],
        ['a solidus', '2 cups / 1 tablespoon all-purpose flour'],
        ['square brackets', '1 pound [about 4 cups] shredded chicken'],
        ['a vulgar fraction outside Latin-1', '2 cups and ⅓ tablespoon all-purpose flour'],
        ['a conjunction in another script', '2 cups и 1 tablespoon flour'],
    ])('sees a measurement joined by %s', (_why, line) => {
        expect(parseIngredientLine(line).reviewReasons).toContain('measurement_in_name');
    });

    /**
     * ⛔ The UNIT requirement is what keeps a number BELONGING to a food from flagging. Without it this
     * fires on every graded flour, every multigrain loaf and every reduced-fat milk — which would be worse
     * than the defect, because a reason nobody trusts is a reason nobody reads.
     */
    it.each([
        ['a flour grade', '2 cups type 00 flour'],
        ['a grade after a comma', '2 cups Flour, 00'],
        ['a grain count', '2 cups 7-grain bread'],
        ['a fat percentage', '1 cup 2% milk'],
        ['a size word, not a unit', '3 large eggs, separated'],
    ])('stays quiet on %s', (_why, line) => {
        expect(parseIngredientLine(line).reviewReasons).not.toContain('measurement_in_name');
    });
});

/**
 * ⛔ THE PARENTHETICAL STRIP DELETED THE FOOD (U31, measured 2026-08-25).
 *
 * U31 asked whether "`parseIngredientLine` folds measurements into the food name" was closed by the
 * 2026-08-23 fix. On the two shapes the defect record named it is: "2 cups and 1 tablespoon all-purpose
 * flour, sifted" now yields `all-purpose flour, sifted` + `measurement_in_name`, and "1 pound (about 4
 * cups) shredded cooked chicken" yields `shredded cooked chicken` with no reason, correctly.
 *
 * ⚠️ But that fix introduced a WORSE defect of the same class, pointing the other way, and measuring
 * rather than reading is what found it. Three shapes lost text with `reviewReasons: []`:
 *
 * | line                                            | name it produced | reviewReasons |
 * | ----------------------------------------------- | ---------------- | ------------- |
 * | `1 pound (about 4 cups shredded cooked chicken` | `""`             | `[]`          |
 * | `1 can (14.5 ounces diced tomatoes`             | `""`             | `[]`          |
 * | `2 cups flour (a family recipe)`                | `"flour"`        | `[]`          |
 *
 * Both causes sat in ONE condition — the strip fired whenever `findQuantityPhrases` found anything at all
 * inside the brackets:
 *
 *  - the closing bracket was OPTIONAL (`\)?`), so an unclosed `(` swallowed the rest of the line;
 *  - a bare article counts as an amount (`findQuantityPhrases('a family recipe')` returns one span at
 *    `0..1`), so any parenthetical opening with `a`/`an`/`one` was deleted as though it were a
 *    measurement — the exact case `PARENTHESISED`'s own docstring promised would survive.
 *
 * ⛔ Losing the food is strictly worse than the defect U31 raised. A name carrying a measurement resolves
 * to nothing; an EMPTY name means the ingredient itself is gone — and both did it with no review reason.
 *
 * The repair is one rule rather than two: a bracket is stripped only when it is CLOSED and its contents
 * carry a measurement by the same test the residual check already uses — an amount FOLLOWED BY A UNIT.
 * `(about 4 cups)` passes it; `(a family recipe)` does not, because `family` is not a unit.
 */
describe('parseIngredientLine — a bracket is not a licence to delete the food', () => {
    it.each([
        ['an unclosed bracket before the food', '1 pound (about 4 cups shredded cooked chicken', 'chicken'],
        ['an unclosed bracket around a net weight', '1 can (14.5 ounces diced tomatoes', 'tomatoes'],
    ])('keeps the food when there is %s', (_why, line, food) => {
        const parsed = parseIngredientLine(line);

        expect(parsed.name).not.toBe('');
        expect(parsed.name).toContain(food);
    });

    /**
     * ⚠️ The pair to the case above, and the half that makes it safe. An unclosed bracket is not silently
     * repaired — the measurement stays in the name, and SAYING so is what turns a silent corruption into a
     * line a reader is asked to fix.
     */
    it.each([['1 pound (about 4 cups shredded cooked chicken'], ['1 can (14.5 ounces diced tomatoes']])(
        'says the measurement is still in the name of %j',
        (line) => {
            expect(parseIngredientLine(line).reviewReasons).toContain('measurement_in_name');
        },
    );

    /**
     * ⛔ `PARENTHESISED`'s own docstring: "(a family recipe) is prose about the food and must survive".
     * It did not. Every one of these opens with a word `findQuantityPhrases` reads as an amount, which is
     * why "is there a number in here" was never the right question — "is there a UNIT after it" is.
     */
    it.each([
        ['an indefinite article', '2 cups flour (a family recipe)', 'a family recipe'],
        ['an "an"', '2 cups flour (an heirloom recipe)', 'an heirloom recipe'],
        ['a spelled-out one', '1 cup sugar (one of two batches)', 'one of two batches'],
    ])('keeps a parenthetical that only LOOKS numeric — %s', (_why, line, aside) => {
        const parsed = parseIngredientLine(line);

        expect(parsed.name).toContain(aside);
        expect(parsed.reviewReasons).not.toContain('measurement_in_name');
    });

    /**
     * ⛔ THE MUTATION LENS. Every assertion above is satisfied by a strip that does nothing at all, so
     * these are the cases that fail the moment the rule is loosened into "never remove a bracket". They
     * are the behaviour U31's 2026-08-23 fix bought, and must not be handed back to buy the fix above.
     */
    it.each([
        ['a restated volume', '1 pound (about 4 cups) shredded cooked chicken', 'shredded cooked chicken'],
        ['a net weight before a container', '1 (14.5 ounce) can diced tomatoes', 'can diced tomatoes'],
        ['a net weight after a container', '1 can (14.5 ounces) diced tomatoes', 'diced tomatoes'],
        ['a historical measure', '1 cup milk (one gill) scalded', 'milk scalded'],
    ])('still takes %s out of the name', (_why, line, expected) => {
        expect(parseIngredientLine(line).name).toBe(expected);
    });

    /**
     * ⚠️ A restatement is one amount said twice, so the quantity we read is already right and there is
     * nothing to review. Inverting this is the failure `splitMeasurement`'s header names: reading an
     * equivalent as additive DOUBLES the ingredient.
     */
    it('does not ask for review when the bracket only restated the amount', () => {
        const parsed = parseIngredientLine('1 pound (about 4 cups) shredded cooked chicken');

        expect(parsed.quantity).toEqual({ kind: 'exact', value: 1 });
        expect(parsed.unit).toBe('lb');
        expect(parsed.reviewReasons).toEqual([]);
    });

    /**
     * ⚠️ `splitMeasurement.ts` carries a polynomial-ReDoS regression guard for the same reason, and its
     * header names the shape: an unanchored `\s*` beside a group that can FAIL is retried at every start
     * position. `PARENTHESISED` carried exactly that prefix while this defect was live, so the budget is
     * pinned here rather than left for the next reader to rediscover.
     */
    it('reads a pathological run of spaces before an unclosed bracket in linear time', () => {
        const pathological = `1 cup ${' '.repeat(20_000)}(`;
        const startedAt = performance.now();

        expect(parseIngredientLine(pathological).name).toBe('(');
        expect(performance.now() - startedAt).toBeLessThan(100);
    });
});

/**
 * ⚠️ U31, ROW 3 — IT SURVIVES, DELIBERATELY, AND THIS RECORDS THE DECISION RATHER THAN THE BUG.
 *
 * The defect record's third row is `a handful of fresh basil leaves, torn` producing
 * `name: "handful of fresh basil leaves, torn"` with `reviewReasons: []`. Measured 2026-08-25 it still
 * does, and so do `a knob of butter` and `a splash of milk` — while `a pinch`, `a dash`, `a sprig` and
 * `a bunch` read cleanly, because `parse-ingredient` already knows those four words.
 *
 * ⛔ So this is NOT the segmentation defect U31 names. Nothing is folding a SECOND measurement into the
 * name; one measure word is missing from a UNIT LEXICON. The distinction decides the fix, and the obvious
 * fix is refused on evidence:
 *
 *  - `IMPORT_UNITS` would take `handful` in one line, exactly as R31 taught it `tablespoonfuls`. But a
 *    handful has no gram weight and no source table that could give it one — R32/R33 admit a
 *    conversion-less unit ONLY because a book's own table of weights and measures resolves it, and no
 *    book publishes a handful.
 *  - It would also change what gets IMPORTED. `cookbook-import`'s `ingredientInClause` accepts a clause
 *    only when `parsed.unit !== null`, so today this line is declined; minting the unit would admit it
 *    carrying `1 handful`, which nutrition cannot cost.
 *  - The canonical contract already owns the right home for it. `ParsedFacts.statedMeasure` was
 *    introduced by U16 for exactly this class — "a measure like `the size of an egg` states something
 *    real that `quantity` is right to record as absent".
 *
 * ⛔ And it must NOT be closed by widening `measurement_in_name` to fire here: that reason means "the
 * quantity understates the line", a vague measure understates nothing, and a reason that fires on
 * everything is a reason nobody reads.
 */
describe('parseIngredientLine — a measure word the unit lexicon does not know', () => {
    it.each([
        ['a handful of fresh basil leaves, torn', 'handful of fresh basil leaves, torn'],
        ['a knob of butter', 'knob of butter'],
        ['a splash of milk', 'splash of milk'],
    ])('leaves the measure word of %j in the name, unflagged', (line, name) => {
        const parsed = parseIngredientLine(line);

        expect(parsed.name).toBe(name);
        expect(parsed.unit).toBeNull();
        expect(parsed.reviewReasons).not.toContain('measurement_in_name');
    });

    /**
     * ⚠️ The pair that keeps the case above from reading as "vague measures are unsupported". The four
     * words `parse-ingredient` DOES define come out as units — which is what the entry above would be
     * extending, and what makes it a lexicon decision rather than a parser one.
     */
    it.each([
        ['a pinch of saffron', 'pinch', 'saffron'],
        ['a dash of bitters', 'dash', 'bitters'],
        ['a sprig of rosemary', 'sprig', 'rosemary'],
        ['a bunch of parsley', 'bunch', 'parsley'],
    ])('reads %j as a unit and a food', (line, unit, name) => {
        const parsed = parseIngredientLine(line);

        expect(parsed.unit).toBe(unit);
        expect(parsed.name).toBe(name);
    });
});
