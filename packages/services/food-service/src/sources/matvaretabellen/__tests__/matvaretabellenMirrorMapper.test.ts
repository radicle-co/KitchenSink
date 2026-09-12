/**
 * A Matvaretabellen mirror item as an extract line (plan U28, R53, KTD-24): the same line the xlsx extractor writes
 * for the same food, read from the publisher's JSON instead of its workbook, so a picked mirror item and a seeded
 * citation hold their values under one definition each.
 *
 * The nutrient list is CLOSED: fat, available carbohydrate (`Karbo`, MI0181, which excludes fibre), fibre, protein,
 * and energy in kcal as published. ⚠️ The kJ `energy` field is NOT read. On 2026-10-01 332 of its 2,121 values were
 * floating-point tails (`1272.8162236915814`) and 29 of the 66 cited foods differ from the workbook's whole kJ, so it
 * is no published number; rounding it would be a conversion, which only `basisConversion` makes (KTD-24); and energy
 * is stored in kcal as published (R53).
 *
 * A value is the publisher's number as a plain decimal of at most three places, or absent. A stated zero is kept,
 * and a `null` is absent, never 0. Anything else rejects the item (reject-not-store, FR-ADP-2).
 */
import { describe, expect, it } from 'vitest';

import { isAdapterValidationError } from '../../foodSource.errors.js';
import { mirrorPullOf, type MirrorItem } from '../../mirror/mirrorFeed.js';
import {
    makeMatvaretabellenFood,
    type MatvaretabellenConstituent,
} from '../__fixtures__/matvaretabellenFood.fixtures.js';
import { MATVARETABELLEN_MIRROR_TAGS, matvaretabellenExtractLine } from '../matvaretabellenMirrorMapper.js';

/** A mirror item for a food. */
function itemOf(food: Record<string, unknown>): MirrorItem {
    const [item] = mirrorPullOf([{ externalKey: '06.178', name: 'Adzuki beans, uncooked', payload: food }]).items;

    if (item === undefined) {
        throw new Error('fixture produced no item');
    }

    return item;
}

/** The fixture with one constituent replaced. */
function withConstituent(constituent: MatvaretabellenConstituent): Record<string, unknown> {
    const food = makeMatvaretabellenFood();

    return {
        ...food,
        constituents: food.constituents.map((each) =>
            each.nutrientId === constituent.nutrientId ? constituent : each,
        ),
    };
}

describe('matvaretabellenExtractLine', () => {
    it("reads the closed list's five values under their own definitions, as plain decimals", () => {
        expect(matvaretabellenExtractLine(itemOf(makeMatvaretabellenFood()))).toEqual({
            key: '06.178',
            name: 'Adzuki beans, uncooked',
            basis: 'per100g',
            values: { CHOAVL: '50.2', ENERC_KCAL: '310', FAT: '0.5', FIBTG: '13', PROCNT: '19.9' },
        });
    });

    it('names exactly the five tags it reads', () => {
        expect([...MATVARETABELLEN_MIRROR_TAGS].sort()).toEqual(['CHOAVL', 'ENERC_KCAL', 'FAT', 'FIBTG', 'PROCNT']);
    });

    it('ignores the kJ energy, even a floating-point tail, and every constituent outside the list', () => {
        const food = makeMatvaretabellenFood({
            energy: { sourceId: 'MI0114', quantity: 1272.8162236915814, unit: 'kJ' },
        });

        expect(Object.keys(matvaretabellenExtractLine(itemOf(food)).values).sort()).toEqual([
            'CHOAVL',
            'ENERC_KCAL',
            'FAT',
            'FIBTG',
            'PROCNT',
        ]);
    });

    it('keeps a stated zero', () => {
        const line = matvaretabellenExtractLine(
            itemOf(withConstituent({ nutrientId: 'Fiber', sourceId: '50', quantity: 0, unit: 'g' })),
        );

        expect(line.values.FIBTG).toBe('0');
    });

    it.each([
        ['a null quantity', { nutrientId: 'Fiber', sourceId: '10', quantity: null, unit: 'g' }],
        ['no quantity at all', { nutrientId: 'Fiber', sourceId: '10' }],
    ])('leaves a value absent, never 0, for %s', (_, constituent) => {
        expect(matvaretabellenExtractLine(itemOf(withConstituent(constituent))).values).not.toHaveProperty('FIBTG');
    });

    it('leaves energy absent for a food the table gives none (three foods on 2026-10-01)', () => {
        const food = makeMatvaretabellenFood({
            calories: { sourceId: '10', quantity: null, unit: 'kcal' },
            energy: {},
        });

        expect(matvaretabellenExtractLine(itemOf(food)).values).not.toHaveProperty('ENERC_KCAL');
    });

    it('leaves a value absent when the food does not list the constituent', () => {
        const food = makeMatvaretabellenFood();
        const withoutFibre = { ...food, constituents: food.constituents.filter((each) => each.nutrientId !== 'Fiber') };

        expect(matvaretabellenExtractLine(itemOf(withoutFibre)).values).not.toHaveProperty('FIBTG');
    });

    it.each([
        [
            'a negative amount',
            'Fett',
            withConstituent({ nutrientId: 'Fett', sourceId: '1', quantity: -0.5, unit: 'g' }),
        ],
        [
            'an amount with more than three places',
            'Protein',
            withConstituent({ nutrientId: 'Protein', sourceId: '1', quantity: 19.9001, unit: 'g' }),
        ],
        [
            'an amount JavaScript writes with an exponent',
            'Fiber',
            withConstituent({ nutrientId: 'Fiber', sourceId: '1', quantity: 1e-7, unit: 'g' }),
        ],
        [
            'an amount in another unit',
            'Fett',
            withConstituent({ nutrientId: 'Fett', sourceId: '1', quantity: 500, unit: 'mg' }),
        ],
        ['an amount with no unit', 'Karbo', withConstituent({ nutrientId: 'Karbo', sourceId: '1', quantity: 50.2 })],
        [
            'energy in kJ where kcal is read',
            'calories',
            makeMatvaretabellenFood({ calories: { sourceId: 'MI0115', quantity: 1297, unit: 'kJ' } }),
        ],
        [
            'a constituent listed twice',
            'Protein',
            {
                ...makeMatvaretabellenFood(),
                constituents: [
                    ...makeMatvaretabellenFood().constituents,
                    { nutrientId: 'Protein', sourceId: '1', quantity: 20, unit: 'g' },
                ],
            },
        ],
        ['a food with no constituents list', 'constituents', { ...makeMatvaretabellenFood(), constituents: undefined }],
        ['a food with no calories', 'calories', { ...makeMatvaretabellenFood(), calories: undefined }],
    ])('rejects %s, naming the field', (_, field, food) => {
        let thrown: unknown;

        try {
            matvaretabellenExtractLine(itemOf(food));
        } catch (error) {
            thrown = error;
        }

        expect(isAdapterValidationError(thrown)).toBe(true);
        expect(
            isAdapterValidationError(thrown) && { source: thrown.source, key: thrown.externalKey, field: thrown.field },
        ).toEqual({
            source: 'matvaretabellen',
            key: '06.178',
            field,
        });
    });
});
