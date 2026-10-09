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
