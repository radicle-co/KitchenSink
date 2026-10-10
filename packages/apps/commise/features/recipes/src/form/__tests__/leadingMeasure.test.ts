/**
 * Unit tests for the add field's leading-measure reader (`form/leadingMeasure.ts`; blueprint A1, build spec §7.5.3).
 *
 * The table is the reader's specification: what the cook types in front of the food search, and what the row is then
 * committed with. Each row states one rule, so a broken rule fails by name:
 *
 * - the amount: a number, a mixed number, an ASCII or unicode fraction, a non-ASCII decimal digit, or a range joined by
 *   `-`, `–`, `—` or `to`;
 * - the KNOWN unit: the next one or two tokens, case preserved, known when recipe-core's `classifyUnit` knows it, stored
 *   as `normalizeUnit` spells it;
 * - the preparation: what follows the first comma that is not inside a number;
 * - the search: everything else, and the whole text when no amount leads it.
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { readLeadingMeasure, type LeadingMeasureReading } from '../leadingMeasure.js';

const exact = (value: number): IngredientQuantity => ({ kind: 'exact', value });
const range = (low: number, high: number): IngredientQuantity => ({ kind: 'range', low, high });

/** One row of the table: what is typed, and the reading it must produce. */
interface Case {
    readonly typed: string;
    readonly reading: LeadingMeasureReading;
    readonly why: string;
}

const CASES: readonly Case[] = [
    {
        typed: '2 tbsp olive oil, for frying',
        reading: {
            quantity: exact(2),
            unit: 'tablespoon',
            search: 'olive oil',
            preparation: 'for frying',
            measureText: '2 tbsp',
        },
        why: 'the spec example: amount, known unit, search, and the preparation after the comma',
    },
    {
        typed: 'salt',
        reading: { quantity: ABSENT_QUANTITY, unit: '', search: 'salt', preparation: '', measureText: '' },
        why: 'no measure: the whole text is the search, and the row has no amount',
    },
    {
        typed: '2 eggs',
        reading: { quantity: exact(2), unit: '', search: 'eggs', preparation: '', measureText: '2' },
        why: 'a count with no unit: `eggs` is a food, not a unit',
    },
    {
        typed: '1 large onion, finely chopped',
        reading: {
            quantity: exact(1),
            unit: '',
            search: 'large onion',
            preparation: 'finely chopped',
            measureText: '1',
        },
        why: '`large` is not in recipe-core’s unit vocabulary (A1 delegates "known" to classifyUnit), so it stays in the search',
    },
    {
        typed: '1 1/2 cups flour',
        reading: { quantity: exact(1.5), unit: 'cup', search: 'flour', preparation: '', measureText: '1 1/2 cups' },
        why: 'a mixed number over two tokens',
    },
    {
        typed: '1-1/2 cups flour',
        reading: { quantity: exact(1.5), unit: 'cup', search: 'flour', preparation: '', measureText: '1-1/2 cups' },
        why: 'the hyphenated mixed number reads as one amount, not the range 1 to 0.5',
    },
    {
        typed: '½ cup milk',
        reading: { quantity: exact(0.5), unit: 'cup', search: 'milk', preparation: '', measureText: '½ cup' },
        why: 'a unicode vulgar fraction',
    },
    {
        typed: '1½ cups milk',
        reading: { quantity: exact(1.5), unit: 'cup', search: 'milk', preparation: '', measureText: '1½ cups' },
        why: 'a whole number glued to a vulgar fraction',
    },
    {
        typed: '٣ cups rice',
        reading: { quantity: exact(3), unit: 'cup', search: 'rice', preparation: '', measureText: '٣ cups' },
        why: 'a non-ASCII decimal digit (`\\p{Nd}`): the case the Hermes precondition is about',
    },
    {
        typed: '2–2.5 kg lamb shoulder, bone-in',
        reading: {
            quantity: range(2, 2.5),
            unit: 'kg',
            search: 'lamb shoulder',
            preparation: 'bone-in',
            measureText: '2–2.5 kg',
        },
        why: 'a range joined by an en dash inside one token',
    },
    {
        typed: '2-3 cloves garlic',
        reading: { quantity: range(2, 3), unit: 'clove', search: 'garlic', preparation: '', measureText: '2-3 cloves' },
        why: 'a range joined by a hyphen inside one token',
    },
    {
        typed: '2 to 3 cups stock',
        reading: { quantity: range(2, 3), unit: 'cup', search: 'stock', preparation: '', measureText: '2 to 3 cups' },
        why: 'a range joined by the word `to`',
    },
    {
        typed: '2 — 3 tsp sugar',
        reading: {
            quantity: range(2, 3),
            unit: 'teaspoon',
            search: 'sugar',
            preparation: '',
            measureText: '2 — 3 tsp',
        },
        why: 'a range joined by a spaced em dash',
    },
    {
        typed: '3 to 2 cups stock',
        reading: { quantity: range(2, 3), unit: 'cup', search: 'stock', preparation: '', measureText: '3 to 2 cups' },
        why: 'an inverted range is swapped, the owner’s rule for the draft’s bounds (2026-09-12)',
    },
    {
        typed: '2 T sugar',
        reading: { quantity: exact(2), unit: 'tablespoon', search: 'sugar', preparation: '', measureText: '2 T' },
        why: 'case preserved: capital T is a tablespoon',
    },
    {
        typed: '2 t sugar',
        reading: { quantity: exact(2), unit: 'teaspoon', search: 'sugar', preparation: '', measureText: '2 t' },
        why: 'case preserved: lower-case t is a teaspoon',
    },
    {
        typed: '8 fl oz cream',
        reading: { quantity: exact(8), unit: 'fluid ounce', search: 'cream', preparation: '', measureText: '8 fl oz' },
        why: 'a two-token unit is read before a one-token one',
    },
    {
        typed: '200g butter, softened',
        reading: {
            quantity: exact(200),
            unit: 'g',
            search: 'butter',
            preparation: 'softened',
            measureText: '200g',
        },
        why: 'a known unit glued to its amount',
    },
    {
        typed: '7up',
        reading: { quantity: ABSENT_QUANTITY, unit: '', search: '7up', preparation: '', measureText: '' },
        why: 'letters glued to a number that are not a known unit are a name, not a measure',
    },
    {
        typed: '2 cups of flour',
        reading: { quantity: exact(2), unit: 'cup', search: 'flour', preparation: '', measureText: '2 cups' },
        why: 'the `of` after a unit is dropped, so the food search is not asked for "of flour"',
    },
    {
        typed: '1,000 g flour',
        reading: { quantity: exact(1000), unit: 'g', search: 'flour', preparation: '', measureText: '1,000 g' },
        why: 'a comma between two digits is part of the number, not the preparation’s separator',
    },
    {
        typed: '2 pinch salt, to taste, divided',
        reading: {
            quantity: exact(2),
            unit: 'pinch',
            search: 'salt',
            preparation: 'to taste, divided',
            measureText: '2 pinch',
        },
        why: 'only the FIRST comma separates: the rest of the text is the preparation',
    },
    {
        typed: '0 cups flour',
        reading: { quantity: ABSENT_QUANTITY, unit: '', search: '0 cups flour', preparation: '', measureText: '' },
        why: 'zero is not an amount the wire accepts (statedQuantity), so nothing is read as a measure',
    },
    {
        typed: '   2   tbsp    olive   oil   ',
        reading: {
            quantity: exact(2),
            unit: 'tablespoon',
            search: 'olive oil',
            preparation: '',
            measureText: '2 tbsp',
        },
        why: 'runs of whitespace collapse',
    },
    {
        typed: '',
        reading: { quantity: ABSENT_QUANTITY, unit: '', search: '', preparation: '', measureText: '' },
        why: 'an empty field reads as nothing',
    },
    {
        typed: '2 cups',
        reading: { quantity: exact(2), unit: 'cup', search: '', preparation: '', measureText: '2 cups' },
        why: 'a measure with no food yet: the search is empty until the cook types it',
    },
    {
        typed: 'II cups flour',
        reading: { quantity: ABSENT_QUANTITY, unit: '', search: 'II cups flour', preparation: '', measureText: '' },
        why: 'roman numerals are not read as amounts (numeric-quantity’s option stays off)',
    },
];

/**
 * The comma's two meanings inside an amount, as a fixture table over SHAPES (finding 10 of the 2026-10-09 review: `1,5 kg
 * flour` read as 15 kg). A comma followed by one or two digits is a decimal point; only `\d{1,3}(,\d{3})+` groups
 * thousands. Every other comma inside digits is ambiguous, and an ambiguous amount is not read at all: a wrong number is
 * the one thing the reader must never produce (owner, "cooking is an art"), while an unread one leaves the cook's text in
 * the search where they can see it.
 */
const COMMA_SHAPES: readonly Case[] = [
    {
        typed: '1,5 kg flour',
        reading: { quantity: exact(1.5), unit: 'kg', search: 'flour', preparation: '', measureText: '1,5 kg' },
        why: 'one digit after the comma: a decimal point',
    },
    {
        typed: '12,5 g salt',
        reading: { quantity: exact(12.5), unit: 'g', search: 'salt', preparation: '', measureText: '12,5 g' },
        why: 'one digit after the comma, two before: a decimal point',
    },
    {
        typed: '1,50 kg flour',
        reading: { quantity: exact(1.5), unit: 'kg', search: 'flour', preparation: '', measureText: '1,50 kg' },
        why: 'two digits after the comma: a decimal point',
    },
    {
        typed: '1,000 g flour',
        reading: { quantity: exact(1000), unit: 'g', search: 'flour', preparation: '', measureText: '1,000 g' },
        why: 'three digits after the comma: thousands',
    },
    {
        typed: '12,345 g flour',
        reading: { quantity: exact(12345), unit: 'g', search: 'flour', preparation: '', measureText: '12,345 g' },
        why: 'two digits, then a group of three: thousands',
    },
    {
        typed: '1,000,000 g flour',
        reading: {
            quantity: exact(1000000),
            unit: 'g',
            search: 'flour',
            preparation: '',
            measureText: '1,000,000 g',
        },
        why: 'every group of three: thousands',
    },
    {
        typed: '1,5000 g flour',
        reading: { quantity: ABSENT_QUANTITY, unit: '', search: '1,5000 g flour', preparation: '', measureText: '' },
        why: 'four digits after the comma is neither shape: ambiguous, so no amount is read',
    },
    {
        typed: '1,5 kg flour, sifted',
        reading: { quantity: exact(1.5), unit: 'kg', search: 'flour', preparation: 'sifted', measureText: '1,5 kg' },
        why: 'the decimal comma is inside the number; the preparation starts at the second comma',
    },
    {
        typed: '2, 3 eggs',
        reading: { quantity: exact(2), unit: '', search: '', preparation: '3 eggs', measureText: '2' },
        why: 'a comma followed by a space is the preparation’s separator, never part of the number',
    },
];

describe('readLeadingMeasure — the comma inside an amount', () => {
    it.each(COMMA_SHAPES)('reads "$typed" — $why', ({ typed, reading }) => {
        expect(readLeadingMeasure(typed)).toEqual(reading);
    });
});

describe('readLeadingMeasure', () => {
    it.each(CASES)('reads "$typed" — $why', ({ typed, reading }) => {
        expect(readLeadingMeasure(typed)).toEqual(reading);
    });

    it('never produces a quantity the wire refuses', () => {
        for (const { typed } of CASES) {
            const { quantity } = readLeadingMeasure(typed);

            if (quantity.kind === 'exact') {
                expect(quantity.value).toBeGreaterThan(0);
            }

            if (quantity.kind === 'range') {
                expect(quantity.low).toBeGreaterThan(0);
                expect(quantity.high).toBeGreaterThan(quantity.low);
            }
        }
    });
});
