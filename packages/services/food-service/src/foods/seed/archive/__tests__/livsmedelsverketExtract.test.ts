/**
 * The Livsmedelsdatabasen extractor (plan U23, KTD-20, R53; ADR-0052 §8). It reads the publisher's whole-table
 * workbook, the "Ladda ner Livsmedelsdatabasen" download: a title row naming the database's version, a row stating the
 * basis, a header row, then one row per food. The columns are named only by header text, so the exact header is
 * asserted at every mapped column, and the version must be the edition the register attributes. The carbohydrate
 * column is available carbohydrate by difference (`CHOAVLDF`), never read under another definition's name. The
 * workbook stores every value as a number and prints no value type, so a trace reads as the 0 it prints.
 */
import { Buffer } from 'node:buffer';

import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';

import { SOURCE_REGISTER } from '../../../../sources/sourceRegister.js';
import { withDataDescriptors } from '../__fixtures__/zipFixture.js';
import { livsmedelsverketExtractor, livsmedelsverketLines } from '../livsmedelsverketExtract.js';
import { numericCell, type TableCell } from '../tableCell.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** The title row's text for the register's edition. */
const TITLE = `Livsmedelsverkets livsmedelsdatabas version ${SOURCE_REGISTER.livsmedelsverket.edition}`;

/** The basis row's text. */
const BASIS = 'Näringsinnehåll per 100 gram livsmedel';

/** The header row's first columns, as the 2026-07-01 workbook prints them, then one column the extractor never reads. */
const HEADER: readonly string[] = [
    'Livsmedelsnamn',
    'Livsmedelsnummer',
    'Gruppering',
    'Energi (kcal)',
    'Energi (kJ)',
    'Fett, totalt (g)',
    'Protein (g)',
    'Kolhydrater, tillgängliga (g)',
    'Fiber (g)',
    'Vatten (g)',
];

/** Senap fransk, food 1973, with a distinct value in every column, so a column read under the wrong tag shows. */
const MUSTARD: readonly TableCell[] = [
    'Senap fransk',
    numericCell('1973'),
    'Kryddor, såser',
    numericCell('101'),
    numericCell('421'),
    numericCell('5'),
    numericCell('6'),
    numericCell('2.4'),
    numericCell('1.7'),
    numericCell('79.6'),
];

/** What the mustard reads as. */
const MUSTARD_LINE = {
    key: '1973',
    name: 'Senap fransk',
    basis: 'per100g',
    values: { ENERC_KCAL: '101', ENERC_KJ: '421', FAT: '5', PROCNT: '6', CHOAVLDF: '2.4', FIBTG: '1.7' },
} as const;

/**
 * The workbook's one sheet.
 *
 * @param rows - The food rows.
 * @param preamble - The title, basis and header rows.
 * @returns The sheet.
 */
function sheet(
    rows: readonly (readonly TableCell[])[],
    preamble: { readonly title?: string; readonly basis?: string; readonly header?: readonly string[] } = {},
): TableCell[][] {
    return [
        [preamble.title ?? TITLE],
        [preamble.basis ?? BASIS],
        [...(preamble.header ?? HEADER)],
        ...rows.map((row) => [...row]),
    ];
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
 * Assert that a call is refused as a table format error whose message holds each fragment.
 *
 * @param call - The call.
 * @param fragments - Text the refusal must name.
 */
function expectRefused(call: () => unknown, ...fragments: readonly string[]): void {
    let error: unknown;

    try {
        call();
    } catch (caught) {
        error = caught;
    }

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

describe('livsmedelsverketLines', () => {
    it('reads each mapped column into the INFOODS tag of its definition, keyed by the food number as text', () => {
        expect(livsmedelsverketLines(sheet([MUSTARD]), new Set(['1973']))).toEqual([MUSTARD_LINE]);
    });

    it('reads "Kolhydrater, tillgängliga" as available carbohydrate by difference, under no other definition', () => {
        const [line] = livsmedelsverketLines(sheet([MUSTARD]), new Set(['1973']));

        expect(line?.values).toHaveProperty('CHOAVLDF', '2.4');
        expect(line?.values).not.toHaveProperty('CHOAVL');
        expect(line?.values).not.toHaveProperty('CHOCDF');
    });

    it('trims the name, which the publisher prints with a trailing space', () => {
        const lines = livsmedelsverketLines(sheet([withCell(MUSTARD, 0, 'Senap fransk ')]), new Set(['1973']));

        expect(lines[0]?.name).toBe('Senap fransk');
    });

    it('reads an empty cell as no value and no trace, and keeps the other values', () => {
        const lines = livsmedelsverketLines(sheet([withCell(MUSTARD, 8, null)]), new Set(['1973']));
        const { FIBTG: _fibre, ...others } = MUSTARD_LINE.values;

        expect(lines[0]?.values).toEqual(others);
        expect(lines[0]).not.toHaveProperty('traces');
    });

    // The workbook carries no value type: a logical zero, a value below the limit of detection or of quantification,
    // and a measured zero all print 0. So a 0 is read as the value 0, and the extract never holds a trace.
    it('reads a printed 0 as the value 0, never as a trace', () => {
        const lines = livsmedelsverketLines(sheet([withCell(MUSTARD, 5, numericCell('0'))]), new Set(['1973']));

        expect(lines[0]?.values).toHaveProperty('FAT', '0');
        expect(lines[0]).not.toHaveProperty('traces');
    });

    it.each<[string, TableCell]>([
        ['text, though the workbook stores every value as a number', '2.4'],
        ['a trace mark', 'Tr'],
        ['a negative number', numericCell('-1')],
        ['a number of more than three places', numericCell('2.4567')],
    ])('refuses %s in a mapped column, naming the row and the column', (_what, cell) => {
        expectRefused(
            () => livsmedelsverketLines(sheet([withCell(MUSTARD, 7, cell)]), new Set(['1973'])),
            'row 4',
            'Kolhydrater, tillgängliga (g)',
        );
    });

    it('leaves out a row nobody requested and a key the table lacks, and never reads an unrequested row’s values', () => {
        const other = withCell(withCell(MUSTARD, 1, numericCell('26')), 3, 'x');
        const lines = livsmedelsverketLines(sheet([other, MUSTARD]), new Set(['1973', '9999']));

        expect(lines).toEqual([MUSTARD_LINE]);
    });

    it.each<[string, TableCell]>([
        ['stored as text', '1973'],
        ['empty', null],
        ['zero', numericCell('0')],
        ['a fraction', numericCell('19.73')],
    ])('refuses a food number %s, in any row', (_what, cell) => {
        expectRefused(() => livsmedelsverketLines(sheet([withCell(MUSTARD, 1, cell)]), new Set()), 'row 4');
    });

    it.each<[string, TableCell]>([
        ['stored as a number', numericCell('7')],
        ['blank', ' '],
    ])('refuses a requested food whose name is %s', (_what, cell) => {
        expectRefused(() => livsmedelsverketLines(sheet([withCell(MUSTARD, 0, cell)]), new Set(['1973'])), 'row 4');
    });

    it('refuses a requested food number the table holds twice', () => {
        expectRefused(() => livsmedelsverketLines(sheet([MUSTARD, MUSTARD]), new Set(['1973'])), '1973');
    });

    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('refuses an edition whose header at index %i differs', (index) => {
        const header = HEADER.map((cell, column) => (column === index ? `${cell} ` : cell));

        expectRefused(
            () => livsmedelsverketLines(sheet([MUSTARD], { header }), new Set(['1973'])),
            'row 3',
            HEADER[index] ?? '',
        );
    });

    // The register's attribution names the version ("Livsmedelsverkets Livsmedelsdatabas version 2026-07-01."), so a
    // workbook of another version would be cited under a credit that is not its own.
    it('refuses a workbook of a version other than the edition the register attributes', () => {
        expectRefused(
            () =>
                livsmedelsverketLines(
                    sheet([MUSTARD], { title: 'Livsmedelsverkets livsmedelsdatabas version 2027-01-01' }),
                    new Set(['1973']),
                ),
            'row 1',
            SOURCE_REGISTER.livsmedelsverket.edition,
        );
    });

    it('refuses a workbook whose values are not stated per 100 g', () => {
        expectRefused(
            () => livsmedelsverketLines(sheet([MUSTARD], { basis: 'Näringsinnehåll per portion' }), new Set(['1973'])),
            'row 2',
        );
    });
});

describe('livsmedelsverketExtractor', () => {
    it('reads the one sheet of the table role’s workbook, zipped as the publisher generates it', async () => {
        const bytes = await withDataDescriptors(
            await writeXlsxFile(sheetData(sheet([MUSTARD])), { sheet: 'Blad1' }).toBuffer(),
        );

        expect(livsmedelsverketExtractor.roles).toEqual(['table']);
        await expect(
            livsmedelsverketExtractor.extract(new Map([['table', bytes]]), new Set(['1973'])),
        ).resolves.toEqual([MUSTARD_LINE]);
    });

    it('refuses upstreams without the table role', async () => {
        await expect(
            livsmedelsverketExtractor.extract(new Map([['capture', Buffer.from('x')]]), new Set()),
        ).rejects.toThrow(expect.objectContaining({ name: 'TableFormatError' }));
    });
});
