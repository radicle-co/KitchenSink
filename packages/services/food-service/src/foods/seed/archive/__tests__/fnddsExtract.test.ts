/**
 * The FNDDS extractor (plan U23, R50, KTD-20): the survey foods of the FoodData Central survey download, keyed
 * `fdc:<id>`, with each mapped nutrient copied into the INFOODS tag of its definition.
 *
 * The download's `food_nutrient.csv` holds nutrient NUMBERS in its `nutrient_id` column (measured on the 2024-10-31
 * file), so the fixtures do the same, and the closed-world test feeds the real id of Energy (1008): that is what a
 * future switch to ids would look like.
 */
import { describe, expect, it } from 'vitest';

import { fdcCsv, makeZip } from '../__fixtures__/zipFixture.js';
import { fnddsExtractLines, fnddsExtractor, type FnddsRecord, type FnddsTables } from '../fnddsExtract.js';
import type { ExtractLine } from '../sourceExtract.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** `nutrient.csv` as the 2024-10-31 download writes the six mapped numbers, plus rows the mapping must not take. */
const NUTRIENTS: readonly FnddsRecord[] = [
    { id: '1008', name: 'Energy', unit_name: 'KCAL', nutrient_nbr: '208' },
    { id: '1062', name: 'Energy', unit_name: 'kJ', nutrient_nbr: '268' },
    { id: '1003', name: 'Protein', unit_name: 'G', nutrient_nbr: '203' },
    { id: '1004', name: 'Total lipid (fat)', unit_name: 'G', nutrient_nbr: '204' },
    { id: '1005', name: 'Carbohydrate, by difference', unit_name: 'G', nutrient_nbr: '205' },
    { id: '1079', name: 'Fiber, total dietary', unit_name: 'G', nutrient_nbr: '291' },
    { id: '1087', name: 'Calcium, Ca', unit_name: 'MG', nutrient_nbr: '301' },
    { id: '2047', name: 'Energy (Atwater General Factors)', unit_name: 'KCAL', nutrient_nbr: '957' },
    { id: '1235', name: 'Sugars, added', unit_name: 'G', nutrient_nbr: '' },
];

/**
 * A `food.csv` row.
 *
 * @param fdcId - The id.
 * @param description - The name.
 * @param dataType - The dataset.
 * @returns The record.
 */
function food(fdcId: string, description: string, dataType = 'survey_fndds_food'): FnddsRecord {
    return { fdc_id: fdcId, data_type: dataType, description };
}

/**
 * A `food_nutrient.csv` row, with a nutrient NUMBER in `nutrient_id` as the download writes it.
 *
 * @param fdcId - The food.
 * @param nutrientId - The number.
 * @param value - The amount.
 * @returns The record.
 */
function amount(fdcId: string, nutrientId: string, value: string): FnddsRecord {
    return { fdc_id: fdcId, nutrient_id: nutrientId, amount: value };
}

/**
 * The tables with the given rows and the standard `nutrient.csv`.
 *
 * @param foods - `food.csv`.
 * @param amounts - `food_nutrient.csv`.
 * @param nutrients - `nutrient.csv`.
 * @returns The tables.
 */
function tables(
    foods: readonly FnddsRecord[],
    amounts: readonly FnddsRecord[],
    nutrients: readonly FnddsRecord[] = NUTRIENTS,
): FnddsTables {
    return { nutrient: nutrients, food: foods, foodNutrient: amounts };
}

/**
 * The error a call throws.
 *
 * @param call - The call.
 * @returns What it threw.
 */
function thrown(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }

    return undefined;
}

/**
 * Sort lines by key, so a test does not depend on the order the extractor returns them in.
 *
 * @param lines - The lines.
 * @returns The lines, sorted.
 */
function byKey(lines: readonly ExtractLine[]): ExtractLine[] {
    return [...lines].sort((left, right) => (left.key < right.key ? -1 : 1));
}

const TZATZIKI = food('2705448', 'Tzatziki dip');

describe('fnddsExtractLines', () => {
    it('copies every mapped number into the INFOODS tag of its definition, per 100 g', () => {
        const lines = fnddsExtractLines(
            tables(
                [TZATZIKI],
                [
                    amount('2705448', '208', '97'),
                    amount('2705448', '268', '406'),
                    amount('2705448', '203', '4.73'),
                    amount('2705448', '204', '6.78'),
                    amount('2705448', '205', '4.29'),
                    amount('2705448', '291', '0.3'),
                ],
            ),
            new Set(['fdc:2705448']),
        );

        expect(lines).toEqual([
            {
                key: 'fdc:2705448',
                name: 'Tzatziki dip',
                basis: 'per100g',
                values: {
                    ENERC_KCAL: '97',
                    ENERC_KJ: '406',
                    PROCNT: '4.73',
                    FAT: '6.78',
                    CHOCDF: '4.29',
                    FIBTG: '0.3',
                },
            },
        ]);
    });

    it('keeps a published zero as zero, and takes no nutrient it does not map', () => {
        const [line] = fnddsExtractLines(
            tables([TZATZIKI], [amount('2705448', '291', '0'), amount('2705448', '301', '125')]),
            new Set(['fdc:2705448']),
        );

        expect(line?.values).toEqual({ FIBTG: '0' });
    });

    it('gives a requested food with no nutrient rows a line with no values', () => {
        expect(fnddsExtractLines(tables([food('2705383', 'Milk, human')], []), new Set(['fdc:2705383']))).toEqual([
            { key: 'fdc:2705383', name: 'Milk, human', basis: 'per100g', values: {} },
        ]);
    });

    it('leaves out a requested key that is not an FNDDS food, and a key that is not an FDC key', () => {
        const lines = fnddsExtractLines(
            tables(
                [TZATZIKI, food('170567', 'Spices, sage, ground', 'sr_legacy_food')],
                [amount('2705448', '208', '97'), amount('170567', '208', '315')],
            ),
            new Set(['fdc:2705448', 'fdc:170567', 'fdc:999', '2705448', 'curated:tzatziki']),
        );

        expect(lines.map((line) => line.key)).toEqual(['fdc:2705448']);
    });

    it('never judges the rows of a food nobody requested', () => {
        const lines = fnddsExtractLines(
            tables(
                [TZATZIKI, food('2705623', ''), { fdc_id: '2705630' }],
                [
                    amount('2705448', '208', '97'),
                    amount('2705623', '1008', 'not a number'),
                    amount('2705623', '208', '1'),
                    amount('2705623', '208', '2'),
                    { fdc_id: '2705630' },
                ],
            ),
            new Set(['fdc:2705448']),
        );

        expect(lines).toEqual([
            { key: 'fdc:2705448', name: 'Tzatziki dip', basis: 'per100g', values: { ENERC_KCAL: '97' } },
        ]);
    });

    it('returns each requested food once, whatever order the files list them in', () => {
        const lines = fnddsExtractLines(
            tables(
                [food('2705636', 'Gelato, vanilla'), TZATZIKI],
                [amount('2705448', '203', '4.73'), amount('2705636', '203', '3.5')],
            ),
            new Set(['fdc:2705448', 'fdc:2705636']),
        );

        expect(byKey(lines).map((line) => [line.key, line.name, line.values])).toEqual([
            ['fdc:2705448', 'Tzatziki dip', { PROCNT: '4.73' }],
            ['fdc:2705636', 'Gelato, vanilla', { PROCNT: '3.5' }],
        ]);
    });

    it('refuses a requested food row whose nutrient_id is a nutrient id, not a nutrient number', () => {
        const error = thrown(() =>
            fnddsExtractLines(tables([TZATZIKI], [amount('2705448', '1008', '97')]), new Set(['fdc:2705448'])),
        );

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('2705448');
        expect(String(error)).toContain('1008');
    });

    it('refuses a requested food row with a blank nutrient_id, though nutrient.csv has rows with a blank number', () => {
        const error = thrown(() =>
            fnddsExtractLines(tables([TZATZIKI], [amount('2705448', '', '1')]), new Set(['fdc:2705448'])),
        );

        expect(isTableFormatError(error)).toBe(true);
    });

    it.each(['1.2345', '', '-1', 'N/A', '1e3'])('refuses the amount %j for a requested food', (value) => {
        const error = thrown(() =>
            fnddsExtractLines(tables([TZATZIKI], [amount('2705448', '204', value)]), new Set(['fdc:2705448'])),
        );

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('2705448');
    });

    it.each<[string, FnddsRecord]>([
        ['a row with no amount', { fdc_id: '2705448', nutrient_id: '204' }],
        ['a row with no nutrient_id', { fdc_id: '2705448', amount: '1' }],
    ])('refuses %s for a requested food', (_label, record) => {
        expect(
            isTableFormatError(thrown(() => fnddsExtractLines(tables([TZATZIKI], [record]), new Set(['fdc:2705448'])))),
        ).toBe(true);
    });

    it.each<[string, readonly FnddsRecord[]]>([
        ['an empty description', [food('2705448', '  ')]],
        ['no description', [{ fdc_id: '2705448', data_type: 'survey_fndds_food' }]],
        ['no data_type', [{ fdc_id: '2705448', description: 'Tzatziki dip' }]],
        ['two survey rows', [TZATZIKI, food('2705448', 'Tzatziki')]],
    ])('refuses a requested food with %s in food.csv', (_label, foods) => {
        expect(isTableFormatError(thrown(() => fnddsExtractLines(tables(foods, []), new Set(['fdc:2705448']))))).toBe(
            true,
        );
    });

    it('refuses two amounts of one number for a requested food', () => {
        const error = thrown(() =>
            fnddsExtractLines(
                tables([TZATZIKI], [amount('2705448', '208', '97'), amount('2705448', '208', '98')]),
                new Set(['fdc:2705448']),
            ),
        );

        expect(isTableFormatError(error)).toBe(true);
    });

    /**
     * `nutrient.csv` with one row replaced.
     *
     * @param number - The `nutrient_nbr` of the row to replace.
     * @param replacement - The rows to put in its place.
     * @returns The table.
     */
    function nutrientsWith(number: string, replacement: readonly FnddsRecord[]): FnddsRecord[] {
        return NUTRIENTS.flatMap((row) => (row['nutrient_nbr'] === number ? replacement : [row]));
    }

    it.each<[string, readonly FnddsRecord[]]>([
        [
            'number 205 names another definition',
            nutrientsWith('205', [
                { id: '1050', name: 'Carbohydrate, by summation', unit_name: 'G', nutrient_nbr: '205' },
            ]),
        ],
        [
            'number 208 carries another unit',
            nutrientsWith('208', [{ id: '1008', name: 'Energy', unit_name: 'kJ', nutrient_nbr: '208' }]),
        ],
        [
            'number 291 is in milligrams',
            nutrientsWith('291', [{ id: '1079', name: 'Fiber, total dietary', unit_name: 'MG', nutrient_nbr: '291' }]),
        ],
        ['number 268 is absent', nutrientsWith('268', [])],
        [
            'number 203 is listed twice',
            nutrientsWith('203', [
                { id: '1003', name: 'Protein', unit_name: 'G', nutrient_nbr: '203' },
                { id: '1002', name: 'Protein', unit_name: 'G', nutrient_nbr: '203' },
            ]),
        ],
    ])('refuses nutrient.csv when %s', (_label, nutrients) => {
        const error = thrown(() =>
            fnddsExtractLines(
                tables([TZATZIKI], [amount('2705448', '208', '97')], nutrients),
                new Set(['fdc:2705448']),
            ),
        );

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('nutrient.csv');
    });
});

describe('fnddsExtractor', () => {
    const DIR = 'FoodData_Central_survey_food_csv_2024-10-31/';

    /**
     * A survey download: the three files the extractor reads, nested one folder deep as USDA ships them.
     *
     * @param foodHeader - `food.csv`'s header.
     * @returns The zip's bytes.
     */
    async function surveyZip(
        foodHeader: readonly string[] = ['fdc_id', 'data_type', 'description', 'food_category_id'],
    ) {
        return makeZip({
            [DIR]: '',
            [`${DIR}nutrient.csv`]: fdcCsv([
                ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'],
                ...NUTRIENTS.map((row) => [
                    row['id'] ?? '',
                    row['name'] ?? '',
                    row['unit_name'] ?? '',
                    row['nutrient_nbr'] ?? '',
                    '1.0',
                ]),
            ]),
            [`${DIR}food.csv`]: fdcCsv([
                foodHeader,
                ['2705448', 'survey_fndds_food', 'Tzatziki dip', '1'],
                ['2705449', 'survey_fndds_food', 'Ranch dip, regular', '1'],
            ]),
            [`${DIR}food_nutrient.csv`]: fdcCsv([
                ['id', 'fdc_id', 'nutrient_id', 'amount', 'data_points'],
                ['1', '2705448', '208', '97', ''],
                ['2', '2705448', '205', '4.29', ''],
                ['3', '2705449', '1008', 'x', ''],
            ]),
        });
    }

    it('reads the survey download it is pinned to, under the role survey', async () => {
        expect(fnddsExtractor.roles).toEqual(['survey']);

        const lines = await fnddsExtractor.extract(new Map([['survey', await surveyZip()]]), new Set(['fdc:2705448']));

        expect(lines).toEqual([
            {
                key: 'fdc:2705448',
                name: 'Tzatziki dip',
                basis: 'per100g',
                values: { ENERC_KCAL: '97', CHOCDF: '4.29' },
            },
        ]);
    });

    it('refuses a download whose food.csv lacks a column it reads, as a table format error', async () => {
        const bytes = await surveyZip(['fdc_id', 'dataType', 'description', 'food_category_id']);

        await expect(fnddsExtractor.extract(new Map([['survey', bytes]]), new Set(['fdc:2705448']))).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError', message: expect.stringContaining('food.csv') }),
        );
    });

    it('refuses a call that gives no survey download', async () => {
        await expect(fnddsExtractor.extract(new Map(), new Set(['fdc:2705448']))).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError' }),
        );
    });
});
