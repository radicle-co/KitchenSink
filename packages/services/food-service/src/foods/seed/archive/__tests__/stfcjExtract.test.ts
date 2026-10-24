/**
 * The Standard Tables of Food Composition in Japan's extractor (plan U23, KTD-20, KTD-24): the `表全体` sheet's
 * columns are found by MEXT's own component identifiers (row 12), never by position, and each value is the table's
 * own number, its estimate in parentheses, a trace (`Tr`, `(Tr)`), which lands in the line's traces, or `-`, not
 * measured, which stays absent. The pure mapping is driven with row matrices; the xlsx Adapter with a workbook written
 * by `write-excel-file`.
 */
import type { Buffer } from 'node:buffer';

import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';

import { stfcjExtractor, stfcjLines } from '../stfcjExtract.js';
import { numericCell, type TableCell } from '../tableCell.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** A full-width space, as MEXT spaces out its header captions. */
const W = '\u3000';

/**
 * The identifier row's identifiers, in MEXT's order from column 5, with the near neighbours a prefix or position
 * reader would take instead: PROTCAA before PROT-, FATNLEA before FAT-, CHOAVLDF- after CHOAVL, and the two
 * unlabelled columns that hold `*` flags.
 */
const IDENTIFIERS: readonly (string | null)[] = [
    'REFUSE',
    'ENERC',
    'ENERC_KCAL',
    'WATER',
    'PROTCAA',
    'PROT-',
    'FATNLEA',
    'CHOLE',
    'FAT-',
    'CHOAVLM',
    null,
    'CHOAVL',
    'CHOAVLDF-',
    null,
    'FIB-',
    'POLYL',
    'CHOCDF-',
    'OA',
];

/** Where the component columns start (0-based): after group, key, index number and name. */
const FIRST_COMPONENT = 4;

/**
 * The sheet's twelve header rows, as MEXT lays them out.
 *
 * @param identifiers - Row 12's identifiers from column 5.
 * @returns The rows.
 */
function makeHeader(identifiers: readonly (string | null)[] = IDENTIFIERS): TableCell[][] {
    const width = FIRST_COMPONENT + identifiers.length;
    const blank = (): TableCell[] => Array.from({ length: width }, () => null);
    const rows = Array.from({ length: 12 }, blank);
    const units = identifiers.map((id) => (id === 'ENERC' ? 'kJ' : id === 'ENERC_KCAL' ? 'kcal' : null));

    rows[1] = [
        `食${W}品${W}群`,
        `食${W}品${W}番${W}号`,
        `索${W}引${W}番${W}号`,
        `可${W}${W}食${W}${W}部${W}${W} 100${W}${W}g${W}${W}当${W}${W}た${W}${W}り`,
        ...blank().slice(FIRST_COMPONENT),
    ];
    rows[2] = [null, null, null, `食${W}品${W}名`, ...blank().slice(FIRST_COMPONENT)];
    rows[10] = [null, null, null, '単位', ...units];
    rows[11] = [null, null, null, '成分識別子', ...identifiers];

    return rows;
}

/**
 * One food's row: its cells placed under their identifiers. The near neighbours hold values of their own, so reading
 * one in place of its mapped column changes the result.
 *
 * @param key - The food number.
 * @param cells - Cells by identifier.
 * @param identifiers - Row 12's identifiers from column 5.
 * @returns The row.
 */
function makeRow(
    key: TableCell,
    cells: Readonly<Record<string, TableCell>>,
    identifiers: readonly (string | null)[] = IDENTIFIERS,
): TableCell[] {
    const decoys: Readonly<Record<string, TableCell>> = {
        REFUSE: numericCell('0'),
        WATER: numericCell('13.5'),
        PROTCAA: '(11.3)',
        FATNLEA: '5.9',
        CHOLE: '(0)',
        'CHOAVLDF-': numericCell('59.9'),
        POLYL: '-',
        OA: '-',
    };

    return [
        '01',
        key,
        '0001',
        `アマランサス${W}玄穀`,
        ...identifiers.map((id) =>
            id === null ? '*' : Object.hasOwn(cells, id) ? (cells[id] ?? null) : (decoys[id] ?? '-'),
        ),
    ];
}

/** A food whose every mapped column holds a different plain number. */
const AMARANTH: Readonly<Record<string, TableCell>> = {
    ENERC: numericCell('1452'),
    ENERC_KCAL: numericCell('343'),
    'PROT-': numericCell('12.7'),
    'FAT-': '6.0',
    CHOAVLM: numericCell('63.5'),
    CHOAVL: numericCell('57.8'),
    'FIB-': numericCell('7.4'),
    'CHOCDF-': numericCell('64.9'),
};

/** AMARANTH's line. */
const AMARANTH_LINE = {
    key: '01001',
    name: `アマランサス${W}玄穀`,
    basis: 'per100g',
    values: {
        ENERC_KJ: '1452',
        ENERC_KCAL: '343',
        PROCNT: '12.7',
        FAT: '6.0',
        CHOAVLM: '63.5',
        CHOAVL: '57.8',
        FIBTG: '7.4',
        CHOCDF: '64.9',
    },
};

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

describe('stfcjLines', () => {
    it('reads each mapped column by its identifier into the tag of its definition', () => {
        expect(stfcjLines([...makeHeader(), makeRow('01001', AMARANTH)], new Set(['01001']))).toEqual([AMARANTH_LINE]);
    });

    it('finds the columns wherever MEXT puts them', () => {
        const moved = [...IDENTIFIERS].reverse();

        expect(stfcjLines([...makeHeader(moved), makeRow('01001', AMARANTH, moved)], new Set(['01001']))).toEqual([
            AMARANTH_LINE,
        ]);
    });

    it.each<[TableCell, string]>([
        ['(0.1)', '0.1'],
        ['(40.5)', '40.5'],
        ['(0)', '0'],
        ['0', '0'],
        ['48.0', '48.0'],
        [numericCell('64.9'), '64.9'],
        [numericCell('45'), '45'],
    ])('reads %j as %j, and never as a trace', (cell, value) => {
        const [line] = stfcjLines(
            [...makeHeader(), makeRow('01001', { ...AMARANTH, 'FAT-': cell })],
            new Set(['01001']),
        );

        expect(line?.values.FAT).toBe(value);
        expect(line).not.toHaveProperty('traces');
    });

    it('reads -, not measured, as no value and no trace', () => {
        const [line] = stfcjLines(
            [...makeHeader(), makeRow('01001', { ...AMARANTH, 'FIB-': '-' })],
            new Set(['01001']),
        );

        expect(line?.values).not.toHaveProperty('FIBTG');
        expect(line?.values.ENERC_KCAL).toBe('343');
        expect(line).not.toHaveProperty('traces');
    });
    it.each<TableCell>(['Tr', '(Tr)'])('reads %j as a trace of its component', (cell) => {
        const [line] = stfcjLines(
            [...makeHeader(), makeRow('01001', { ...AMARANTH, 'FIB-': cell })],
            new Set(['01001']),
        );

        expect(line?.values).not.toHaveProperty('FIBTG');
        expect(line?.values.ENERC_KCAL).toBe('343');
        expect(line?.traces).toEqual(['FIBTG']);
    });

    it('keeps a trace in a column it does not map out of the traces', () => {
        const [line] = stfcjLines(
            [...makeHeader(), makeRow('01001', { ...AMARANTH, POLYL: 'Tr', PROTCAA: '(Tr)', 'CHOAVLDF-': 'Tr' })],
            new Set(['01001']),
        );

        expect(line).toEqual(AMARANTH_LINE);
        expect(line).not.toHaveProperty('traces');
    });

    it.each<TableCell>([
        '18.5†',
        'tr',
        '(-)',
        '(Tr',
        '(0.1',
        '((0.1))',
        '( 0.1 )',
        '*',
        '',
        null,
        numericCell('1e-7'),
        numericCell('-0.5'),
    ])('refuses %j, which is no form MEXT prints', (cell) => {
        const error = thrown(() =>
            stfcjLines([...makeHeader(), makeRow('01001', { 'FAT-': cell })], new Set(['01001'])),
        );

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('FAT-');
    });

    it('leaves out a requested key the table does not hold, and reads no value of a row nobody requested', () => {
        const rows = [...makeHeader(), makeRow('01001', AMARANTH), makeRow('03032', { CHOAVL: '18.5†' })];

        expect(stfcjLines(rows, new Set(['01001', '99999']))).toEqual([AMARANTH_LINE]);
    });

    it.each([
        ['a number', numericCell('1001')],
        ['four digits', '0001'],
        ['empty', null],
    ])('refuses a key that is %s', (_case, key) => {
        expect(isTableFormatError(thrown(() => stfcjLines([...makeHeader(), makeRow(key, AMARANTH)], new Set())))).toBe(
            true,
        );
    });

    it('refuses a key the table lists twice', () => {
        const rows = [...makeHeader(), makeRow('01001', AMARANTH), makeRow('01001', AMARANTH)];
        const error = thrown(() => stfcjLines(rows, new Set()));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('01001');
    });

    it('refuses a requested row with no name', () => {
        const row = makeRow('01001', AMARANTH);
        row[3] = null;

        expect(isTableFormatError(thrown(() => stfcjLines([...makeHeader(), row], new Set(['01001']))))).toBe(true);
    });

    it.each([
        ['FAT- is missing, though FATNLEA is there', IDENTIFIERS.map((id) => (id === 'FAT-' ? 'FAT' : id))],
        ['PROT- is missing, though PROTCAA is there', IDENTIFIERS.filter((id) => id !== 'PROT-')],
        ['CHOAVL appears twice', [...IDENTIFIERS, 'CHOAVL']],
    ])('refuses an identifier row where %s', (_case, identifiers) => {
        const error = thrown(() => stfcjLines(makeHeader(identifiers), new Set()));

        expect(isTableFormatError(error)).toBe(true);
    });

    it.each([
        ['the energy units swapped', 10, 5, 'kcal'],
        ['no identifier caption', 11, 3, '成分'],
        ['no food-number caption', 1, 1, '食品番号'],
        ['no food-name caption', 2, 3, '食品名'],
        ['a basis other than 100 g edible portion', 1, 3, `可${W}${W}食${W}${W}部${W}${W} 100${W}${W}mL`],
    ])('refuses a header with %s', (_case, row, column, text) => {
        const header = makeHeader();
        const cells = header[row] ?? [];
        cells[column] = text;

        expect(isTableFormatError(thrown(() => stfcjLines(header, new Set())))).toBe(true);
    });
});

/**
 * A cell as `write-excel-file` takes it: a stored number becomes a spreadsheet number again.
 *
 * @param cell - The cell.
 * @returns The writer's value.
 */
function written(cell: TableCell): string | number | null {
    return cell !== null && typeof cell === 'object' ? Number(cell.numeric) : cell;
}

/**
 * Write the sheet as a workbook.
 *
 * @param rows - The sheet's rows.
 * @param sheet - The sheet's name.
 * @returns The workbook's bytes.
 */
async function workbook(rows: readonly (readonly TableCell[])[], sheet = '表全体'): Promise<Buffer> {
    const data: SheetData = rows.map((row) => row.map(written));

    return writeXlsxFile(data, { sheet }).toBuffer();
}

describe('stfcjExtractor', () => {
    it('reads the file named table', () => {
        expect(stfcjExtractor.roles).toEqual(['table']);
    });
    it('reads the 表全体 sheet of the published workbook, keeping the key, the printed digits and the traces', async () => {
        const rows = [
            ...makeHeader(),
            makeRow('01001', AMARANTH),
            makeRow('17016', { ...AMARANTH, 'FAT-': '(0)', 'FIB-': 'Tr', CHOAVL: '(Tr)', 'PROT-': '(0.2)' }),
        ];
        const lines = await stfcjExtractor.extract(new Map([['table', await workbook(rows)]]), new Set(['17016']));

        expect(lines).toEqual([
            {
                ...AMARANTH_LINE,
                key: '17016',
                values: {
                    ENERC_KJ: '1452',
                    ENERC_KCAL: '343',
                    PROCNT: '0.2',
                    FAT: '0',
                    CHOAVLM: '63.5',
                    CHOCDF: '64.9',
                },
                traces: ['CHOAVL', 'FIBTG'],
            },
        ]);
    });

    it('refuses a workbook without the 表全体 sheet', async () => {
        const bytes = await workbook([...makeHeader(), makeRow('01001', AMARANTH)], '1穀類');

        await expect(stfcjExtractor.extract(new Map([['table', bytes]]), new Set(['01001']))).rejects.toSatisfy(
            isTableFormatError,
        );
    });

    it('refuses upstreams that do not name the table', async () => {
        await expect(stfcjExtractor.extract(new Map(), new Set(['01001']))).rejects.toSatisfy(isTableFormatError);
    });
});
