/**
 * The Matvaretabellen 2026 extractor (plan U23, KTD-20, R53). The Foods sheet names its columns only by header text,
 * so the exact header is asserted at every mapped column. Every value is text with a decimal comma, a food group is a
 * heading row with nothing but its name, and every food, drinks included, is published per 100 g. The table prints no
 * trace mark, so an empty cell is no value and no trace, and a trace mark is refused.
 */
import { Buffer } from 'node:buffer';

import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';

import { matvaretabellenExtractor, matvaretabellenLines } from '../matvaretabellenExtract.js';
import { numericCell, type TableCell } from '../tableCell.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** The Foods header row, as the 2026 workbook prints it. */
const HEADER: readonly string[] = [
    'Matvare ID',
    'Matvare',
    'Spiselig del (%)',
    'Water (g)',
    'Kilojoule (kJ)',
    'Kilokalorier (kcal)',
    'Fat (g)',
    'Carbohydrate (g)',
    'Dietary fibre (g)',
    'Protein (g)',
    'Alcohol (g)',
];

/** A food row with a distinct value in every column, so a column read under the wrong tag shows. */
const APPENZELLER: readonly TableCell[] = [
    '01.344',
    'Appenzeller, cheese',
    '100',
    '44',
    '1586',
    '383',
    '31,7',
    '0,5',
    '1,2',
    '24,3',
    '0,9',
];

/** What Appenzeller reads as. */
const APPENZELLER_LINE = {
    key: '01.344',
    name: 'Appenzeller, cheese',
    basis: 'per100g',
    values: { ENERC_KJ: '1586', ENERC_KCAL: '383', FAT: '31.7', CHOAVL: '0.5', FIBTG: '1.2', PROCNT: '24.3' },
} as const;

/** A heading row: the group's name and nothing else. */
const DAIRY_HEADING: readonly TableCell[] = ['Dairy products', ...HEADER.slice(1).map((): TableCell => null)];

/**
 * The Foods sheet.
 *
 * @param rows - The rows after the header.
 * @param header - The header row.
 * @returns The sheet.
 */
function foodsSheet(rows: readonly (readonly TableCell[])[], header: readonly string[] = HEADER): TableCell[][] {
    return [[...header], ...rows.map((row) => [...row])];
}

/**
 * A copy of a row with one cell replaced.
 *
 * @param row - The row.
 * @param index - The cell's column.
 * @param cell - The new cell.
 * @returns The new row.
 */
function withCell(row: readonly TableCell[], index: number, cell: TableCell): TableCell[] {
    return row.map((value, column) => (column === index ? cell : value));
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
 * Assert that a call is refused as a table format error whose message holds each fragment.
 *
 * @param call - The call.
 * @param fragments - Text the refusal must name.
 */
function expectRefused(call: () => unknown, ...fragments: readonly string[]): void {
    const error = thrown(call);

    expect(isTableFormatError(error)).toBe(true);

    for (const fragment of fragments) {
        expect(String(error)).toContain(fragment);
    }
}

/**
 * Rows as write-excel-file takes them: a numeric cell becomes a number, so the workbook stores it as one.
 *
 * @param rows - The rows.
 * @returns The sheet data.
 */
function sheetData(rows: readonly (readonly TableCell[])[]): SheetData {
    return rows.map((row) =>
        row.map((cell) => (cell === null || typeof cell === 'string' ? cell : Number(cell.numeric))),
    );
}

describe('matvaretabellenLines', () => {
    it('reads each mapped column into the INFOODS tag of its definition, with the decimal comma read', () => {
        expect(matvaretabellenLines(foodsSheet([APPENZELLER]), new Set(['01.344']))).toEqual([APPENZELLER_LINE]);
    });

    it('skips a heading row that holds only a food group’s name', () => {
        expect(matvaretabellenLines(foodsSheet([DAIRY_HEADING, APPENZELLER]), new Set(['01.344']))).toEqual([
            APPENZELLER_LINE,
        ]);
    });

    it.each<[string, TableCell]>([
        ['an empty cell', null],
        ['empty text', ''],
    ])('reads a food whose edible part is %s, which is no heading', (_what, cell) => {
        const chicken = ['03.511', 'Butter chicken, industrially made', cell, '69', '776', '187', '13,2', '5,2', '0,9'];
        const lines = matvaretabellenLines(foodsSheet([[...chicken, '11,3', '0']]), new Set(['03.511']));

        expect(lines).toEqual([
            {
                key: '03.511',
                name: 'Butter chicken, industrially made',
                basis: 'per100g',
                values: {
                    ENERC_KJ: '776',
                    ENERC_KCAL: '187',
                    FAT: '13.2',
                    CHOAVL: '5.2',
                    FIBTG: '0.9',
                    PROCNT: '11.3',
                },
            },
        ]);
    });

    it('refuses a row that holds values but no food name', () => {
        expectRefused(
            () => matvaretabellenLines(foodsSheet([withCell(APPENZELLER, 1, null)]), new Set(['01.344'])),
            'row 2',
        );
    });

    it.each<[string, TableCell]>([
        ['an empty cell', null],
        ['empty text', ''],
        ['blank text', ' '],
    ])('reads %s as no value and no trace, and keeps the other values', (_what, cell) => {
        const lines = matvaretabellenLines(foodsSheet([withCell(APPENZELLER, 5, cell)]), new Set(['01.344']));
        const { ENERC_KCAL: _kcal, ...others } = APPENZELLER_LINE.values;

        expect(lines[0]?.values).toEqual(others);
        expect(lines[0]).not.toHaveProperty('traces');
    });

    it.each<[string, TableCell]>([
        ['an unknown token', 'x'],
        ['a dash', '-'],
        ['a bound', '<0,1'],
        ['a trace mark, which this table never writes', 'Tr'],
        ['a decimal point, which this table never writes', '1.586'],
        ['two decimal commas', '1,5,8'],
    ])('refuses %s in a mapped column, naming the row and the column', (_what, cell) => {
        expectRefused(
            () =>
                matvaretabellenLines(foodsSheet([DAIRY_HEADING, withCell(APPENZELLER, 4, cell)]), new Set(['01.344'])),
            'row 3',
            'Kilojoule (kJ)',
        );
    });

    it('trims the key as it is printed, and leaves out a row nobody requested and a key the table lacks', () => {
        const lines = matvaretabellenLines(
            foodsSheet([withCell(APPENZELLER, 0, '01.332 '), withCell(APPENZELLER, 0, '01.345')]),
            new Set(['01.332', '13.052']),
        );

        expect(lines.map((line) => line.key)).toEqual(['01.332']);
    });

    it('does not read the values of a row nobody requested', () => {
        const lines = matvaretabellenLines(
            foodsSheet([APPENZELLER, ['01.345', 'Burrata cheese', '100', '60', 'x', 'x', 'x', 'x', 'x', 'x', 'x']]),
            new Set(['01.344']),
        );

        expect(lines).toEqual([APPENZELLER_LINE]);
    });

    it('refuses a food name stored as a number', () => {
        expectRefused(
            () => matvaretabellenLines(foodsSheet([withCell(APPENZELLER, 1, numericCell('7'))]), new Set()),
            'row 2',
        );
    });

    it('refuses a key stored as a number, whose zeros are lost', () => {
        expectRefused(
            () => matvaretabellenLines(foodsSheet([withCell(APPENZELLER, 0, numericCell('1.344'))]), new Set()),
            'row 2',
        );
    });

    it('refuses a requested key the table holds twice', () => {
        expectRefused(
            () => matvaretabellenLines(foodsSheet([APPENZELLER, APPENZELLER]), new Set(['01.344'])),
            '01.344',
        );
    });

    it('reads an alcoholic drink per 100 g, with no density: the table converts alcohol to grams per 100 g of drink', () => {
        const vermouth = ['13.052', 'Fortified wines, sweet vermouth, 15 vol-% alcohol', '100', '76', '545', '130'];
        const lines = matvaretabellenLines(
            foodsSheet([[...vermouth, '0', '13,3', '0', '0', '11']]),
            new Set(['13.052']),
        );

        expect(lines).toEqual([
            {
                key: '13.052',
                name: 'Fortified wines, sweet vermouth, 15 vol-% alcohol',
                basis: 'per100g',
                values: { ENERC_KJ: '545', ENERC_KCAL: '130', FAT: '0', CHOAVL: '13.3', FIBTG: '0', PROCNT: '0' },
            },
        ]);
    });

    it.each([0, 1, 4, 5, 6, 7, 8, 9])('refuses an edition whose header at index %i differs', (index) => {
        const header = HEADER.map((cell, column) => (column === index ? `${cell} ` : cell));

        expectRefused(
            () => matvaretabellenLines(foodsSheet([APPENZELLER], header), new Set(['01.344'])),
            'row 1',
            HEADER[index] ?? '',
        );
    });
});

describe('matvaretabellenExtractor', () => {
    it('reads the Foods sheet of the table role’s workbook through the xlsx adapter', async () => {
        const bytes = await writeXlsxFile([
            { data: [['The Norwegian Food Composition Table 2026']], sheet: 'Information' },
            { data: sheetData(foodsSheet([DAIRY_HEADING, APPENZELLER])), sheet: 'Foods' },
        ]).toBuffer();

        expect(matvaretabellenExtractor.roles).toEqual(['table']);
        await expect(
            matvaretabellenExtractor.extract(new Map([['table', bytes]]), new Set(['01.344'])),
        ).resolves.toEqual([APPENZELLER_LINE]);
    });

    it('refuses upstreams without the table role', async () => {
        await expect(
            matvaretabellenExtractor.extract(new Map([['other', Buffer.from('x')]]), new Set()),
        ).rejects.toThrow(expect.objectContaining({ name: 'TableFormatError' }));
    });
});
