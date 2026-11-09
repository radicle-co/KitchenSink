/**
 * `pastedLineRowOf` — the measure and name the editor SAVES for one food of a pasted line, and therefore the measure the
 * paste matcher must key its verdict on (ADR-0071).
 *
 * ⛔ One rule, two callers. The editor (`pastedLines.ts`) saves a pasted row with this measure, and recipe-service's
 * `matchJudgementOf` keys the gate's verdict with it. Where they differed, `2 tbsp` saved unit `tbsp` while the matcher
 * keyed `tablespoon`, and the save path paid the gate again for a line it had already judged.
 *
 * The rules, from the editor's former `cookMeasureOf`: the cook's own words win (spec §7.5.3); the parse's reading
 * stands where those words state no amount this reader reads but the parse read one ("one cup"), or where the parse kept
 * no words; and only the FIRST food of a line carries the line's amount, while a line that states no amount ("to taste")
 * says its words of every food.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY } from '../../ingredientQuantity.js';
import { pastedLineRowOf, type PastedLineParse } from '../pastedLineMeasure.js';

/** A parse that says nothing about its source line or its display, for the cases that are not about either. */
const rowOf = (
    parse: Omit<PastedLineParse, 'sourceLine' | 'display'> & Partial<Pick<PastedLineParse, 'sourceLine' | 'display'>>,
    foodIndex: number,
    name: string,
) => pastedLineRowOf({ sourceLine: '', display: null, ...parse }, foodIndex, name);

describe('pastedLineRowOf — the first food of a line', () => {
    it.each([
        ['2 tbsp', { kind: 'exact', value: 2 }, 'tablespoon', { kind: 'exact', value: 2 }, 'tbsp'],
        ['1 T', { kind: 'exact', value: 1 }, 'tablespoon', { kind: 'exact', value: 1 }, 'T'],
        ['1 t', { kind: 'exact', value: 1 }, 'teaspoon', { kind: 'exact', value: 1 }, 't'],
        ['2-3 cups', { kind: 'range', low: 2, high: 3 }, 'cup', { kind: 'range', low: 2, high: 3 }, 'cups'],
        ['1 large', { kind: 'exact', value: 1 }, null, { kind: 'exact', value: 1 }, 'large'],
    ] as const)('keeps the cook’s words for %j', (statedMeasure, quantity, unit, expectedQuantity, expectedUnit) => {
        expect(rowOf({ quantity, unit, statedMeasure }, 0, 'onion')).toStrictEqual({
            quantity: expectedQuantity,
            unit: expectedUnit,
            name: 'onion',
        });
    });

    it('keeps the parse’s reading where the words state no amount this reader reads, but the parse read one', () => {
        expect(
            rowOf({ quantity: { kind: 'exact', value: 1 }, unit: 'gill', statedMeasure: 'one gill' }, 0, 'milk'),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'gill', name: 'milk' });
    });

    it('keeps the words, and no amount, where neither the words nor the parse state one', () => {
        expect(
            rowOf({ quantity: ABSENT_QUANTITY, unit: null, statedMeasure: 'a handful' }, 0, 'parsley'),
        ).toStrictEqual({ quantity: ABSENT_QUANTITY, unit: 'a handful', name: 'parsley' });
    });

    it.each([null, undefined, '   '])(
        'keeps the parse’s reading when the parse kept no words (%j)',
        (statedMeasure) => {
            expect(
                rowOf({ quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure }, 0, 'flour'),
            ).toStrictEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'cup', name: 'flour' });
        },
    );

    it('spells a parse with no unit as the empty unit, as the editor saves it', () => {
        expect(rowOf({ quantity: { kind: 'exact', value: 3 }, unit: null }, 0, 'eggs')).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
            name: 'eggs',
        });
    });
});

/**
 * ADR-0026 §8 (owner ruling 2026-08-26): a size word is a unit. The parse prompt and the CRF promotion both keep a
 * leading size word in the food's NAME ("3 large eggs" → name `large eggs`, no unit), so §8's merge rescue never fires
 * on a plain count. The row therefore takes the size word as its unit, so the line reads "3 large eggs" beside any
 * matched food, and `unitToGrams` can meet a catalog portion labelled `large`.
 */
describe('pastedLineRowOf — a size word is a unit (ADR-0026 §8)', () => {
    it.each([
        ['large eggs', 'large', 'eggs'],
        ['Large eggs', 'Large', 'eggs'],
        ['small onion', 'small', 'onion'],
        ['medium yellow onions', 'medium', 'yellow onions'],
        ['jumbo shrimp', 'jumbo', 'shrimp'],
        ['extra large eggs', 'extra large', 'eggs'],
        ['extra-large eggs', 'extra-large', 'eggs'],
    ] as const)('a counted %j takes its size word as the unit', (phrase, unit, name) => {
        expect(
            rowOf({ quantity: { kind: 'exact', value: 3 }, unit: null, statedMeasure: '3' }, 0, phrase),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit,
            name,
        });
    });

    it('moves the size word on a range too', () => {
        expect(
            rowOf({ quantity: { kind: 'range', low: 2, high: 3 }, unit: null, statedMeasure: '2-3' }, 0, 'large eggs'),
        ).toStrictEqual({ quantity: { kind: 'range', low: 2, high: 3 }, unit: 'large', name: 'eggs' });
    });

    it('leaves the name alone when the line already states a unit', () => {
        expect(
            rowOf(
                { quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: '2 cups' },
                0,
                'large-curd cottage cheese',
            ),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'cups', name: 'large-curd cottage cheese' });
        expect(
            rowOf(
                { quantity: { kind: 'exact', value: 1 }, unit: 'cup', statedMeasure: '1 cup' },
                0,
                'small pasta shells',
            ),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'cup', name: 'small pasta shells' });
    });

    it('leaves the name alone when the line states no amount (nothing to count)', () => {
        expect(rowOf({ quantity: ABSENT_QUANTITY, unit: null, statedMeasure: null }, 0, 'large eggs')).toStrictEqual({
            quantity: ABSENT_QUANTITY,
            unit: '',
            name: 'large eggs',
        });
    });

    it('never empties the name: a size word alone stays the name', () => {
        expect(
            rowOf({ quantity: { kind: 'exact', value: 2 }, unit: null, statedMeasure: '2' }, 0, 'large'),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 2 },
            unit: '',
            name: 'large',
        });
    });

    it('does not read a size word that is not the first word', () => {
        expect(
            rowOf({ quantity: { kind: 'exact', value: 3 }, unit: null, statedMeasure: '3' }, 0, 'eggs, large'),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
            name: 'eggs, large',
        });
        expect(
            rowOf({ quantity: { kind: 'exact', value: 3 }, unit: null, statedMeasure: '3' }, 0, 'largemouth bass'),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
            name: 'largemouth bass',
        });
    });
});

describe('pastedLineRowOf — a later food of the same line', () => {
    it.each([1, 2])('food %i states no measure: the line gave one amount, and the first food carries it', (index) => {
        expect(
            rowOf(
                { quantity: { kind: 'exact', value: 2 }, unit: 'tablespoon', statedMeasure: '2 tbsp' },
                index,
                'large eggs',
            ),
        ).toStrictEqual({ quantity: ABSENT_QUANTITY, unit: '', name: 'large eggs' });
    });

    it.each([
        ['to taste', 'to taste'],
        ['as needed', 'as needed'],
    ])('food 1 of a line that states no amount carries %j too: there is no amount to give twice', (phrase, unit) => {
        // `salt and pepper to taste` saved salt "to taste" and pepper with nothing (paste import, 2026-11-08).
        const line = { quantity: ABSENT_QUANTITY, unit: phrase, statedMeasure: phrase };

        expect(rowOf(line, 0, 'salt')).toStrictEqual({ quantity: ABSENT_QUANTITY, unit, name: 'salt' });
        expect(rowOf(line, 1, 'pepper')).toStrictEqual({ quantity: ABSENT_QUANTITY, unit, name: 'pepper' });
    });

    it('a later food of a line that states nothing at all states nothing either', () => {
        expect(rowOf({ quantity: ABSENT_QUANTITY, unit: null, statedMeasure: null }, 1, 'pepper')).toStrictEqual({
            quantity: ABSENT_QUANTITY,
            unit: '',
            name: 'pepper',
        });
    });
});

/**
 * Owner ruling 2026-11-08 (ruling 2): a DIMENSION in parentheses is a note on the food and never the unit; a PACKAGE SIZE
 * stays part of the unit, word for word. The unit words are what the parse's `statedMeasure` kept: both engines and the
 * merge turn "(9 inch)" into the unit, so the rule reads the source line to tell the two apart.
 */
describe('pastedLineRowOf: parentheticals (owner ruling 2026-11-08)', () => {
    const one = { kind: 'exact', value: 1 } as const;
    const two = { kind: 'exact', value: 2 } as const;

    it('moves a dimension out of the unit into the note, and takes it off the head of the name', () => {
        expect(
            pastedLineRowOf(
                {
                    sourceLine: '1 (9 inch) double-crust pie pastry',
                    quantity: one,
                    unit: null,
                    statedMeasure: '1 (9 inch)',
                    display: 'written',
                },
                0,
                '9 inch double-crust pie pastry',
            ),
        ).toStrictEqual({
            quantity: one,
            unit: '',
            name: 'double-crust pie pastry',
            displayText: 'double-crust pie pastry',
            note: '9 inch',
        });
    });

    it('keeps the unit word that follows the dimension ("1 (2 inch) piece ginger")', () => {
        expect(
            pastedLineRowOf(
                {
                    sourceLine: '1 (2 inch) piece ginger',
                    quantity: one,
                    unit: 'piece',
                    statedMeasure: '1 (2 inch) piece',
                    display: 'food',
                },
                0,
                'ginger',
            ),
        ).toStrictEqual({ quantity: one, unit: 'piece', name: 'ginger', note: '2 inch' });
    });

    it.each([
        ['2 (9x13 inch) baking dishes', '2 (9x13 inch)', '9x13 inch'],
        ['1 (23 cm) springform pan', '1 (23 cm)', '23 cm'],
    ])('reads %j: a dimension in the unit words is a note', (sourceLine, statedMeasure, note) => {
        const quantity = sourceLine.startsWith('2') ? two : one;
        const row = pastedLineRowOf(
            { sourceLine, quantity, unit: null, statedMeasure, display: null },
            0,
            'baking dishes',
        );

        expect(row).toMatchObject({ unit: '', note, name: 'baking dishes' });
        expect(row).not.toHaveProperty('displayText');
    });

    it.each(['inch', 'in', 'inches', 'cm'])(
        'a parse that read the dimension’s own length word as the unit (%j) states no unit',
        (unit) => {
            expect(
                pastedLineRowOf(
                    { sourceLine: '1 (9 inch) pie crust', quantity: one, unit, display: null },
                    0,
                    'pie crust',
                ),
            ).toStrictEqual({ quantity: one, unit: '', name: 'pie crust', note: '9 inch' });
        },
    );

    it('a dimension belongs to the first food only (the amount is the first food’s)', () => {
        const parse = {
            sourceLine: '1 (9 inch) pie pastry and butter',
            quantity: one,
            unit: null,
            statedMeasure: '1 (9 inch)',
            display: null,
        } as const;

        expect(pastedLineRowOf(parse, 1, 'butter')).not.toHaveProperty('note');
    });

    it.each([
        ['1 (28 ounce) can crushed tomatoes', '1 (28 ounce) can', '(28 ounce) can'],
        ['2 (6.5 ounce) cans tomato sauce', '2 (6.5 ounce) cans', '(6.5 ounce) cans'],
        ['1 (14 oz) can coconut milk', '1 (14 oz) can', '(14 oz) can'],
        ['2 (6 ounce) cans tomato paste', '2 (6 ounce) cans', '(6 ounce) cans'],
    ])('keeps a package size in the unit, word for word: %j', (sourceLine, statedMeasure, unit) => {
        const row = pastedLineRowOf(
            {
                sourceLine,
                quantity: sourceLine.startsWith('2') ? two : one,
                unit: 'ounce',
                statedMeasure,
                display: null,
            },
            0,
            'crushed tomatoes',
        );

        expect(row.unit).toBe(unit);
        expect(row).not.toHaveProperty('note');
    });

    it('a package size takes the container word off the head of the name instead of saying it twice', () => {
        const row = pastedLineRowOf(
            {
                sourceLine: '1 (28 ounce) can crushed tomatoes',
                quantity: one,
                unit: null,
                statedMeasure: '1 (28 ounce)',
                display: null,
            },
            0,
            'can crushed tomatoes',
        );

        expect(row).toMatchObject({ unit: '(28 ounce) can', name: 'crushed tomatoes' });
    });

    it('a dimension at the head of the name is removed even when the unit words hold nothing', () => {
        const row = pastedLineRowOf(
            { sourceLine: '1 (9 inch) pie crust', quantity: one, unit: null, display: null },
            0,
            '(9 inch) pie crust',
        );

        expect(row).toMatchObject({ unit: '', note: '9 inch', name: 'pie crust' });
    });

    it('writes displayText only when the parse answered "written", and never an empty one', () => {
        const parse = { quantity: one, unit: null, sourceLine: '1 lean ground beef' } as const;

        expect(pastedLineRowOf({ ...parse, display: 'written' }, 0, 'lean ground beef')).toHaveProperty(
            'displayText',
            'lean ground beef',
        );
        expect(pastedLineRowOf({ ...parse, display: 'food' }, 0, 'lean ground beef')).not.toHaveProperty('displayText');
        expect(pastedLineRowOf({ ...parse, display: null }, 0, 'lean ground beef')).not.toHaveProperty('displayText');
        expect(pastedLineRowOf({ ...parse, display: 'written' }, 0, '  ')).not.toHaveProperty('displayText');
    });

    it('displayText follows rule 4: a size word moved into the unit is not said twice ("3 large large eggs" trap)', () => {
        const row = pastedLineRowOf(
            {
                sourceLine: '3 large eggs',
                quantity: { kind: 'exact', value: 3 },
                unit: null,
                display: 'written',
            },
            0,
            'large eggs',
        );

        expect(row).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: 'large',
            name: 'eggs',
            displayText: 'eggs',
        });
    });

    it.each([
        ['1 (9 inch) double-crust pie pastry', '1 (9 inch)', '9 inch double-crust pie pastry'],
        ['1 (2 inch) piece ginger', '1 (2 inch) piece', 'piece ginger'],
        ['1 (28 ounce) can crushed tomatoes', '1 (28 ounce) can', 'crushed tomatoes'],
    ])('no word of the cook’s line is said twice across unit, note and name: %j', (sourceLine, statedMeasure, name) => {
        const row = pastedLineRowOf({ sourceLine, quantity: one, unit: null, statedMeasure, display: null }, 0, name);
        const said = [row.unit, row.note ?? '', row.name].join(' ').match(/[\p{L}\p{Nd}.]+/gu) ?? [];
        const written = sourceLine.match(/[\p{L}\p{Nd}.]+/gu) ?? [];
        const count = (words: readonly string[], word: string) =>
            words.filter((w) => w.toLowerCase() === word.toLowerCase()).length;

        for (const word of new Set(said)) {
            expect(count(said, word), word).toBeLessThanOrEqual(count(written, word));
        }
    });
});
