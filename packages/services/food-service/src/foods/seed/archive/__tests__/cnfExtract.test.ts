/**
 * The Canadian Nutrient File 2015 extractor (plan U23, R50, KTD-20). CNF names three things twice, and the tests pin
 * the right half of each pair, because the wrong half reads plausible data:
 *
 * - a food is keyed by `FoodID`, not `FoodCode` (501521 is food code 6324);
 * - a nutrient is joined by `NutrientID` and mapped by its `Tagname`, not by `NutrientCode` (STARCH is ID 810, code
 *   209);
 * - a food's source is its `FoodSourceID`, not `FoodSourceCode` (ID 35 is a USDA copy; code 35 is ID 36, a CNF recipe).
 *
 * A food whose source marks a copy of USDA data is refused (plan U23): it is USDA's data under another name.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { makeZip } from '../__fixtures__/zipFixture.js';
import { CNF_FOOD_SOURCES, cnfExtractLines, cnfExtractor, type CnfRecord, type CnfTables } from '../cnfExtract.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** `FOOD SOURCE.csv` as the 2015 edition lists it. */
const FOOD_SOURCES: readonly CnfRecord[] = [...CNF_FOOD_SOURCES].map(([id, source]) => ({
    FoodSourceID: id,
    FoodSourceDescription: source.description,
}));

/** `NUTRIENT NAME.csv`'s six mapped rows as the 2015 edition writes them, plus STARCH, whose ID is not its code. */
const NUTRIENT_NAMES: readonly CnfRecord[] = [
    { NutrientID: '203', NutrientCode: '203', NutrientUnit: 'g', Tagname: 'PROCNT' },
    { NutrientID: '204', NutrientCode: '204', NutrientUnit: 'g', Tagname: 'FAT' },
    { NutrientID: '205', NutrientCode: '205', NutrientUnit: 'g', Tagname: 'CHOCDF' },
    { NutrientID: '208', NutrientCode: '208', NutrientUnit: 'kCal', Tagname: 'ENERC_KCAL' },
    { NutrientID: '268', NutrientCode: '268', NutrientUnit: 'kJ', Tagname: 'ENERC_KJ' },
    { NutrientID: '291', NutrientCode: '291', NutrientUnit: 'g', Tagname: 'FIBTG' },
    { NutrientID: '810', NutrientCode: '209', NutrientUnit: 'g', Tagname: 'STARCH' },
    { NutrientID: '339', NutrientCode: '328', NutrientUnit: 'µg', Tagname: 'VITD_µG' },
];

/**
 * A `FOOD NAME.csv` row.
 *
 * @param foodId - The key.
 * @param foodSourceId - The source.
 * @param description - The English name.
 * @param foodCode - The food code, which is not the key.
 * @returns The record.
 */
function foodName(foodId: string, foodSourceId: string, description: string, foodCode = foodId): CnfRecord {
    return { FoodID: foodId, FoodCode: foodCode, FoodSourceID: foodSourceId, FoodDescription: description };
}

/**
 * A `NUTRIENT AMOUNT.csv` row.
 *
 * @param foodId - The food.
 * @param nutrientId - The nutrient.
 * @param value - The value.
 * @returns The record.
 */
function amount(foodId: string, nutrientId: string, value: string): CnfRecord {
    return { FoodID: foodId, NutrientID: nutrientId, NutrientValue: value };
}

/**
 * The tables, with the edition's food sources and nutrient names unless a test replaces them.
 *
 * @param foods - `FOOD NAME.csv`.
 * @param amounts - `NUTRIENT AMOUNT.csv`.
 * @param overrides - Replacement reference tables.
 * @returns The tables.
 */
function tables(
    foods: readonly CnfRecord[],
    amounts: readonly CnfRecord[],
    overrides: Partial<Pick<CnfTables, 'foodSource' | 'nutrientName'>> = {},
): CnfTables {
    return {
        foodSource: overrides.foodSource ?? FOOD_SOURCES,
        foodName: foods,
        nutrientName: overrides.nutrientName ?? NUTRIENT_NAMES,
        nutrientAmount: amounts,
    };
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

const MUSTARD = foodName('1135', '20', 'Sauce, mustard, brown, ready-to-serve');

describe('cnfExtractLines', () => {
    it('copies each mapped nutrient into the tag its Tagname names, per 100 g', () => {
        const lines = cnfExtractLines(
            tables(
                [MUSTARD],
                [
                    amount('1135', '208', '67'),
                    amount('1135', '268', '280'),
                    amount('1135', '203', '4.37'),
                    amount('1135', '204', '3.34'),
                    amount('1135', '205', '5.83'),
                    amount('1135', '291', '3.3'),
                ],
            ),
            new Set(['1135']),
        );

        expect(lines).toEqual([
            {
                key: '1135',
                name: 'Sauce, mustard, brown, ready-to-serve',
                basis: 'per100g',
                values: {
                    ENERC_KCAL: '67',
                    ENERC_KJ: '280',
                    PROCNT: '4.37',
                    FAT: '3.34',
                    CHOCDF: '5.83',
                    FIBTG: '3.3',
                },
            },
        ]);
    });

    it('maps by Tagname whatever NutrientID a tag is filed under', () => {
        const swapped = NUTRIENT_NAMES.map((row) => {
            if (row['Tagname'] === 'PROCNT') {
                return { ...row, NutrientID: '204' };
            }

            return row['Tagname'] === 'FAT' ? { ...row, NutrientID: '203' } : row;
        });
        const [line] = cnfExtractLines(
            tables([MUSTARD], [amount('1135', '203', '3.34'), amount('1135', '204', '4.37')], {
                nutrientName: swapped,
            }),
            new Set(['1135']),
        );

        expect(line?.values).toEqual({ PROCNT: '4.37', FAT: '3.34' });
    });

    it('joins an amount by NutrientID, and refuses one filed under the NutrientCode', () => {
        const renumbered = NUTRIENT_NAMES.map((row) =>
            row['Tagname'] === 'ENERC_KCAL' ? { ...row, NutrientID: '9208' } : row,
        );
        const [line] = cnfExtractLines(
            tables([MUSTARD], [amount('1135', '9208', '67')], { nutrientName: renumbered }),
            new Set(['1135']),
        );

        expect(line?.values).toEqual({ ENERC_KCAL: '67' });

        const error = thrown(() =>
            cnfExtractLines(
                tables([MUSTARD], [amount('1135', '208', '67')], { nutrientName: renumbered }),
                new Set(['1135']),
            ),
        );

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('208');
    });

    it('refuses a requested food amount filed under a code that is no NutrientID, as STARCH code 209 would be', () => {
        const error = thrown(() => cnfExtractLines(tables([MUSTARD], [amount('1135', '209', '1')]), new Set(['1135'])));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('1135');
    });

    it('keeps a published zero as zero, and takes no nutrient it does not map', () => {
        const [line] = cnfExtractLines(
            tables([MUSTARD], [amount('1135', '291', '0'), amount('1135', '810', '2.1')]),
            new Set(['1135']),
        );

        expect(line?.values).toEqual({ FIBTG: '0' });
    });

    it('keys a food by FoodID, never by its FoodCode', () => {
        const soup = foodName('501521', '38', 'Soup, butternut squash, ready-to-serve', '6324');
        const lines = cnfExtractLines(tables([soup], [amount('501521', '208', '35')]), new Set(['501521', '6324']));

        expect(lines).toEqual([
            {
                key: '501521',
                name: 'Soup, butternut squash, ready-to-serve',
                basis: 'per100g',
                values: { ENERC_KCAL: '35' },
            },
        ]);
    });

    it('gives a requested food with no amounts a line with no values, and leaves out a key the file lacks', () => {
        expect(cnfExtractLines(tables([MUSTARD], []), new Set(['1135', '999999']))).toEqual([
            { key: '1135', name: 'Sauce, mustard, brown, ready-to-serve', basis: 'per100g', values: {} },
        ]);
    });

    /** Every FoodSourceID the 2015 edition lists, and whether it marks a copy of USDA data. */
    const CLASSIFICATION: readonly [string, boolean][] = [
        ['0', true],
        ['1', true],
        ['3', true],
        ['4', true],
        ['6', true],
        ['9', false],
        ['20', false],
        ['23', false],
        ['24', false],
        ['26', false],
        ['28', false],
        ['29', true],
        ['30', true],
        ['35', true],
        ['36', false],
        ['38', false],
    ];

    it('classifies exactly the sources the 2015 edition lists', () => {
        expect([...CNF_FOOD_SOURCES.keys()].sort()).toEqual(CLASSIFICATION.map(([id]) => id).sort());
    });

    it.each(CLASSIFICATION.filter(([, usdaCopy]) => usdaCopy))(
        'refuses a requested food whose FoodSourceID %s marks a copy of USDA data, naming it',
        (sourceId) => {
            const error = thrown(() =>
                cnfExtractLines(
                    tables([foodName('5', sourceId, 'Chinese dish, chow mein, chicken')], []),
                    new Set(['5']),
                ),
            );

            expect(isTableFormatError(error)).toBe(true);
            expect(String(error)).toContain('5');
            expect(String(error)).toContain('Chinese dish, chow mein, chicken');
            expect(String(error)).toContain(`FoodSourceID ${sourceId}`);
        },
    );

    it.each(CLASSIFICATION.filter(([, usdaCopy]) => !usdaCopy))(
        'admits a requested food whose FoodSourceID %s is CNF’s own or another table’s',
        (sourceId) => {
            expect(cnfExtractLines(tables([foodName('7', sourceId, 'Beef pot roast')], []), new Set(['7']))).toEqual([
                { key: '7', name: 'Beef pot roast', basis: 'per100g', values: {} },
            ]);
        },
    );

    it.each([
        ['32', 'a FoodSourceID FOOD SOURCE.csv does not list'],
        ['', 'no FoodSourceID'],
    ])('refuses a requested food with %j, %s', (sourceId) => {
        expect(
            isTableFormatError(
                thrown(() => cnfExtractLines(tables([foodName('7', sourceId, 'Beef pot roast')], []), new Set(['7']))),
            ),
        ).toBe(true);
    });

    it('never judges the rows of a food nobody requested', () => {
        const lines = cnfExtractLines(
            tables(
                [
                    MUSTARD,
                    foodName('5', '0', 'Chinese dish'),
                    foodName('8', '32', 'Fried chicken'),
                    foodName('9', '', ''),
                ],
                [
                    amount('1135', '208', '67'),
                    amount('534', '328', '0.1'),
                    amount('5', '208', 'n/a'),
                    amount('5', '208', '1'),
                ],
            ),
            new Set(['1135']),
        );

        expect(lines).toEqual([
            {
                key: '1135',
                name: 'Sauce, mustard, brown, ready-to-serve',
                basis: 'per100g',
                values: { ENERC_KCAL: '67' },
            },
        ]);
    });

    it.each(['1.2345', '', '-1', 'Tr'])('refuses the value %j for a requested food', (value) => {
        const error = thrown(() =>
            cnfExtractLines(tables([MUSTARD], [amount('1135', '204', value)]), new Set(['1135'])),
        );

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('1135');
    });

    it.each<[string, readonly CnfRecord[], readonly CnfRecord[]]>([
        ['two FOOD NAME rows', [MUSTARD, MUSTARD], []],
        ['two values of one nutrient', [MUSTARD], [amount('1135', '208', '67'), amount('1135', '208', '68')]],
        ['an empty name', [foodName('1135', '20', ' ')], []],
        ['a row with no value', [MUSTARD], [{ FoodID: '1135', NutrientID: '208' }]],
        ['a row with no NutrientID', [MUSTARD], [{ FoodID: '1135', NutrientValue: '67' }]],
    ])('refuses a requested food with %s', (_label, foods, amounts) => {
        expect(isTableFormatError(thrown(() => cnfExtractLines(tables(foods, amounts), new Set(['1135']))))).toBe(true);
    });

    it.each<[string, readonly CnfRecord[]]>([
        [
            'lists a source the extractor does not classify',
            [...FOOD_SOURCES, { FoodSourceID: '40', FoodSourceDescription: 'NEW' }],
        ],
        ['omits a source the extractor classifies', FOOD_SOURCES.filter((row) => row['FoodSourceID'] !== '9')],
        [
            'describes a source differently',
            FOOD_SOURCES.map((row) =>
                row['FoodSourceID'] === '20' ? { ...row, FoodSourceDescription: 'FOOD BASED ON DATA FROM USDA' } : row,
            ),
        ],
        ['lists a source twice', [...FOOD_SOURCES, ...FOOD_SOURCES.slice(0, 1)]],
    ])('refuses FOOD SOURCE.csv when it %s', (_label, foodSource) => {
        const error = thrown(() => cnfExtractLines(tables([MUSTARD], [], { foodSource }), new Set(['1135'])));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('FOOD SOURCE.csv');
    });

    it.each<[string, readonly CnfRecord[]]>([
        [
            'files kilocalories under another unit',
            NUTRIENT_NAMES.map((row) => (row['Tagname'] === 'ENERC_KCAL' ? { ...row, NutrientUnit: 'kJ' } : row)),
        ],
        [
            'files fibre in milligrams',
            NUTRIENT_NAMES.map((row) => (row['Tagname'] === 'FIBTG' ? { ...row, NutrientUnit: 'mg' } : row)),
        ],
        ['lacks a mapped tag', NUTRIENT_NAMES.filter((row) => row['Tagname'] !== 'ENERC_KJ')],
        [
            'lists a mapped tag twice',
            [...NUTRIENT_NAMES, { NutrientID: '9203', NutrientCode: '9203', NutrientUnit: 'g', Tagname: 'PROCNT' }],
        ],
    ])('refuses NUTRIENT NAME.csv when it %s', (_label, nutrientName) => {
        const error = thrown(() => cnfExtractLines(tables([MUSTARD], [], { nutrientName }), new Set(['1135'])));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('NUTRIENT NAME.csv');
    });
});

describe('cnfExtractor', () => {
    /**
     * Write rows the way the CNF files are written: CRLF, a field quoted only when it holds a comma or a quote.
     *
     * @param rows - The header, then the data rows.
     * @returns The CSV text.
     */
    function cnfCsv(rows: readonly (readonly string[])[]): string {
        const field = (cell: string): string => (/[",\r\n]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell);

        return rows.map((row) => `${row.map(field).join(',')}\r\n`).join('');
    }

    /**
     * Build a zip of Windows-1252 entries, at the root as the CNF zip has them.
     *
     * @param entries - Entry name to text.
     * @returns The zip's bytes.
     */
    async function windows1252Zip(entries: Readonly<Record<string, string>>): Promise<Buffer> {
        // Every character in these fixtures is in Latin-1, where latin1 and Windows-1252 bytes agree.
        return makeZip(
            Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, Buffer.from(text, 'latin1')])),
        );
    }

    /** The four files the extractor reads, as the CNF zip writes them, and a file it does not read. */
    const CNF_FILES: Readonly<Record<string, string>> = {
        'CNF 2015 users_guide EN.pdf': '%PDF',
        'FOOD SOURCE.csv': cnfCsv([
            ['FoodSourceID', 'FoodSourceCode', 'FoodSourceDescription', 'FoodSourceDescriptionF', '', ''],
            ...[...CNF_FOOD_SOURCES].map(([id, source]) => [id, id, source.description, 'ALIMENT', '', '']),
        ]),
        'FOOD NAME.csv': cnfCsv([
            ['FoodID', 'FoodCode', 'FoodGroupID', 'FoodSourceID', 'FoodDescription', 'FoodDescriptionF'],
            ['2', '2', '22', '20', 'Cheese souffle', 'Soufflé au fromage'],
            ['409', '409', '7', '20', 'Pâté, chicken liver, canned', 'Pâté de foie de poulet, en conserve'],
            ['5', '5', '22', '0', 'Chinese dish, chow mein, chicken', 'Mets chinois, chow mein, poulet'],
        ]),
        'NUTRIENT NAME.csv': cnfCsv([
            ['NutrientID', 'NutrientCode', 'NutrientSymbol', 'NutrientUnit', 'NutrientName', 'Tagname'],
            ...NUTRIENT_NAMES.map((row) => [
                row['NutrientID'] ?? '',
                row['NutrientCode'] ?? '',
                'SYM',
                row['NutrientUnit'] ?? '',
                'NAME, WITH A COMMA',
                row['Tagname'] ?? '',
            ]),
        ]),
        'NUTRIENT AMOUNT.csv': cnfCsv([
            ['FoodID', 'NutrientID', 'NutrientValue', 'StandardError'],
            ['409', '208', '201', '0'],
            ['409', '204', '13.1', '0'],
            ['2', '208', '204', '0'],
            ['5', '208', 'x', '0'],
        ]),
    };

    /**
     * A CNF zip: the standard files, with some replaced or removed.
     *
     * @param changes - Entry name to its new text, or `null` to leave the entry out.
     * @returns The zip's bytes.
     */
    async function cnfZip(changes: Readonly<Record<string, string | null>> = {}): Promise<Buffer> {
        const entries = Object.entries({ ...CNF_FILES, ...changes }).filter(
            (entry): entry is [string, string] => entry[1] !== null,
        );

        return windows1252Zip(Object.fromEntries(entries));
    }

    it('reads the Windows-1252 CSVs of the CNF zip, under the role archive', async () => {
        expect(cnfExtractor.roles).toEqual(['archive']);

        const lines = await cnfExtractor.extract(new Map([['archive', await cnfZip()]]), new Set(['409']));

        expect(lines).toEqual([
            {
                key: '409',
                name: 'Pâté, chicken liver, canned',
                basis: 'per100g',
                values: { ENERC_KCAL: '201', FAT: '13.1' },
            },
        ]);
    });

    it('refuses a file that lacks a column it reads, as a table format error', async () => {
        const bytes = await cnfZip({
            'NUTRIENT AMOUNT.csv': cnfCsv([
                ['FoodID', 'NutrientNameID', 'NutrientValue'],
                ['409', '208', '201'],
            ]),
        });

        await expect(cnfExtractor.extract(new Map([['archive', bytes]]), new Set(['409']))).rejects.toThrow(
            expect.objectContaining({
                name: 'TableFormatError',
                message: expect.stringContaining('NUTRIENT AMOUNT.csv'),
            }),
        );
    });

    it.each(['FOOD SOURCE.csv', 'FOOD NAME.csv', 'NUTRIENT NAME.csv', 'NUTRIENT AMOUNT.csv'])(
        'refuses a zip without %s',
        async (name) => {
            const bytes = await cnfZip({ [name]: null });

            await expect(cnfExtractor.extract(new Map([['archive', bytes]]), new Set(['409']))).rejects.toThrow(
                expect.objectContaining({ name: 'TableFormatError', message: expect.stringContaining(name) }),
            );
        },
    );

    it('refuses a ragged row, which the CNF files never write', async () => {
        const bytes = await cnfZip({ 'FOOD SOURCE.csv': 'FoodSourceID,FoodSourceDescription\r\n0,A,B\r\n' });

        await expect(cnfExtractor.extract(new Map([['archive', bytes]]), new Set(['409']))).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError', message: expect.stringContaining('FOOD SOURCE.csv') }),
        );
    });

    it('refuses a call that gives no CNF zip', async () => {
        await expect(cnfExtractor.extract(new Map(), new Set(['409']))).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError' }),
        );
    });
});
