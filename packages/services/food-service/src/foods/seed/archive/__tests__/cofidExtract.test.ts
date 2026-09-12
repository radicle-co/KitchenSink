/**
 * The CoFID 2021 extractor (plan U23, KTD-20, R53, R54). CoFID names each column by its own component code in row 2,
 * so a column is found by its code and never by its position. Its carbohydrate is available carbohydrate as
 * monosaccharide equivalents (`CHOAVLM`), its total dietary fibre is the AOAC column and never NSP, and an alcoholic
 * beverage is published per 100 mL, so its line carries the specific gravity CoFID gives for the same food or is
 * refused. A `Tr` cell is a trace and lands in the line's traces; `N` and an empty cell are not known and stay absent.
 */
import { Buffer } from 'node:buffer';

import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';

import { cofidExtractor, cofidLines } from '../cofidExtract.js';
import { numericCell, type TableCell } from '../tableCell.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** One Proximates column: its row-1 header and its row-2 component code. */
interface Column {
    readonly header: string;
    readonly code: string | null;
}

/** The fixed columns CoFID prints before its first component. */
const LEADING: readonly Column[] = [
    { header: 'Food Code', code: null },
    { header: 'Food Name', code: null },
    { header: 'Description', code: null },
    { header: 'Group', code: null },
];

/** The component columns in CoFID 2021's own order, with a neighbour of each mapped one that must stay unread. */
const COMPONENTS: readonly Column[] = [
    { header: 'Water (g)', code: 'WATER' },
    { header: 'Protein (g)', code: 'PROT' },
    { header: 'Fat (g)', code: 'FAT' },
    { header: 'Carbohydrate (g)', code: 'CHO' },
    { header: 'Energy (kcal) (kcal)', code: 'KCALS' },
    { header: 'Energy (kJ) (kJ)', code: 'KJ' },
    { header: 'NSP (g)', code: 'ENGFIB' },
    { header: 'AOAC fibre (g)', code: 'AOACFIB' },
];

/** A distinct value per code, so a column read under the wrong tag shows. */
const DEFAULTS: Readonly<Record<string, TableCell>> = {
    WATER: '76.7',
    PROT: '2.9',
    FAT: '15.2',
    CHO: '0.8',
    KCALS: '151',
    KJ: '625',
    ENGFIB: '4.4',
    AOACFIB: '5.5',
};

/** What the default values read as. */
const DEFAULT_VALUES = {
    PROCNT: '2.9',
    FAT: '15.2',
    CHOAVLM: '0.8',
    ENERC_KCAL: '151',
    ENERC_KJ: '625',
    FIBTG: '5.5',
} as const;

/** One food of the Proximates sheet. */
interface Food {
    readonly key: TableCell;
    readonly name?: string;
    readonly group?: TableCell;
    readonly values?: Readonly<Record<string, TableCell>>;
}

/**
 * A Proximates sheet: the header row, the code row, the short-name row, then one row per food.
 *
 * @param foods - The foods.
 * @param components - The component columns, in the order to print them.
 * @returns The rows.
 */
function proximatesSheet(foods: readonly Food[], components: readonly Column[] = COMPONENTS): TableCell[][] {
    const columns = [...LEADING, ...components];

    return [
        columns.map((column) => column.header),
        columns.map((column) => column.code),
        columns.map((column) => (column.code === null ? null : (column.header.split(' (')[0] ?? null))),
        ...foods.map((food) => [
            food.key,
            food.name ?? 'Ackee, canned, drained',
            '8 cans',
            food.group === undefined ? 'DG' : food.group,
            ...components.map((column) => {
                const code = column.code ?? '';

                return food.values !== undefined && code in food.values
                    ? (food.values[code] ?? null)
                    : (DEFAULTS[code] ?? null);
            }),
        ]),
    ];
}

/** The Factors header row, as CoFID 2021 prints it. */
const FACTORS_HEADER: readonly string[] = [
    'Food Code',
    'Food Name',
    'Description',
    'Group',
    'Previous',
    'Main data references',
    'Footnote',
    'Edible proportion',
    'Specific gravity',
    'Total solids',
];

/** One food of the Factors sheet. */
interface Factor {
    readonly key: string;
    readonly name: string;
    readonly gravity: TableCell;
}

/**
 * A Factors sheet: the header row, two empty heading rows, then one row per food.
 *
 * @param entries - The foods.
 * @param header - The header row.
 * @returns The rows.
 */
function factorsSheet(entries: readonly Factor[], header: readonly string[] = FACTORS_HEADER): TableCell[][] {
    const empty = header.map((): TableCell => null);

    return [
        [...header],
        empty,
        empty,
        ...entries.map((entry) => [entry.key, entry.name, null, 'QF', null, null, null, '1.00', entry.gravity, null]),
    ];
}

const PORT: Food = { key: '17-234', name: 'Port', group: 'QF', values: { KCALS: '157', KJ: '655', AOACFIB: null } };
const PORT_FACTOR: Factor = { key: '17-234', name: 'Port', gravity: '1.03' };

/** What Port's values read as: its own energy, and no fibre. */
const PORT_VALUES = { PROCNT: '2.9', FAT: '15.2', CHOAVLM: '0.8', ENERC_KCAL: '157', ENERC_KJ: '655' } as const;

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

describe('cofidLines', () => {
    it('reads each mapped code into the INFOODS tag of its definition, and the key and name', () => {
        const lines = cofidLines(
            { proximates: proximatesSheet([{ key: '13-145' }]), factors: factorsSheet([]) },
            new Set(['13-145']),
        );

        expect(lines).toEqual([
            { key: '13-145', name: 'Ackee, canned, drained', basis: 'per100g', values: DEFAULT_VALUES },
        ]);
    });

    it('finds a column by its code, wherever the edition prints it', () => {
        const shuffled = [...COMPONENTS].reverse();
        const lines = cofidLines(
            { proximates: proximatesSheet([{ key: '13-145' }], shuffled), factors: factorsSheet([]) },
            new Set(['13-145']),
        );

        expect(lines[0]?.values).toEqual(DEFAULT_VALUES);
    });

    it('reads the AOAC column as total dietary fibre and never the NSP column, which is another definition', () => {
        const lines = cofidLines(
            {
                proximates: proximatesSheet([{ key: '13-145', values: { ENGFIB: '81.1', AOACFIB: null } }]),
                factors: factorsSheet([]),
            },
            new Set(['13-145']),
        );

        expect(lines[0]?.values).not.toHaveProperty('FIBTG');
        expect(Object.values(lines[0]?.values ?? {})).not.toContain('81.1');
    });
    it.each<[string, TableCell]>([
        ['N, present but not determined', 'N'],
        ['an empty cell', null],
    ])('reads %s as no value and no trace, and keeps the other values', (_mark, cell) => {
        const [line] = cofidLines(
            { proximates: proximatesSheet([{ key: '13-145', values: { CHO: cell } }]), factors: factorsSheet([]) },
            new Set(['13-145']),
        );

        expect(line?.values).toEqual({
            PROCNT: '2.9',
            FAT: '15.2',
            ENERC_KCAL: '151',
            ENERC_KJ: '625',
            FIBTG: '5.5',
        });
        expect(line).not.toHaveProperty('traces');
    });

    it('reads Tr, a trace, into the traces under the tag of its column, and keeps the other values', () => {
        const [line] = cofidLines(
            {
                proximates: proximatesSheet([{ key: '13-145', values: { FAT: 'Tr', AOACFIB: ' Tr ' } }]),
                factors: factorsSheet([]),
            },
            new Set(['13-145']),
        );

        expect(line?.values).toEqual({ PROCNT: '2.9', CHOAVLM: '0.8', ENERC_KCAL: '151', ENERC_KJ: '625' });
        expect(line?.traces).toEqual(['FAT', 'FIBTG']);
    });

    it('keeps a trace in a column it does not map out of the traces', () => {
        const [line] = cofidLines(
            {
                proximates: proximatesSheet([{ key: '13-145', values: { ENGFIB: 'Tr', WATER: 'Tr' } }]),
                factors: factorsSheet([]),
            },
            new Set(['13-145']),
        );

        expect(line).toEqual({
            key: '13-145',
            name: 'Ackee, canned, drained',
            basis: 'per100g',
            values: DEFAULT_VALUES,
        });
        expect(line).not.toHaveProperty('traces');
    });

    it('copies a value stored as a number and a printed zero exactly as published', () => {
        const lines = cofidLines(
            {
                proximates: proximatesSheet([
                    { key: '13-145', values: { PROT: numericCell('2.3'), KCALS: numericCell('12'), FAT: '0.0' } },
                ]),
                factors: factorsSheet([]),
            },
            new Set(['13-145']),
        );

        expect(lines[0]?.values).toMatchObject({ PROCNT: '2.3', ENERC_KCAL: '12', FAT: '0.0' });
    });

    it.each<[string, TableCell]>([
        ['an unknown token', 'trace'],
        ['a trace mark CoFID does not print', 'tr'],
        ['a negative number', '-0.1'],
        ['a spreadsheet float tail', numericCell('2.2999999999999998')],
    ])('refuses %s in a mapped column, naming the row and the code', (_what, cell) => {
        expectRefused(
            () =>
                cofidLines(
                    {
                        proximates: proximatesSheet([{ key: '13-145' }, { key: '17-681', values: { PROT: cell } }]),
                        factors: factorsSheet([]),
                    },
                    new Set(['17-681']),
                ),
            'row 5',
            'PROT',
        );
    });

    it('leaves out a row nobody requested, without reading its values, and a requested key the table lacks', () => {
        const lines = cofidLines(
            {
                proximates: proximatesSheet([{ key: '13-145' }, { key: '13-146', values: { PROT: 'not a value' } }]),
                factors: factorsSheet([]),
            },
            new Set(['13-145', '18-371']),
        );

        expect(lines.map((line) => line.key)).toEqual(['13-145']);
    });

    it('refuses a key stored as a number, whose zeros are lost', () => {
        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([{ key: numericCell('13.145') }]), factors: factorsSheet([]) },
                    new Set(['13-145']),
                ),
            'row 4',
        );
    });

    it('refuses a requested key the table holds twice, and ignores a duplicate nobody requested', () => {
        const sheets = {
            proximates: proximatesSheet([
                { key: '13-669', name: 'Aubergine, flesh and skin, roasted in rapeseed oil' },
                { key: '13-145' },
                { key: '13-669', name: 'Watercress, raw' },
            ]),
            factors: factorsSheet([]),
        };

        expectRefused(() => cofidLines(sheets, new Set(['13-669'])), '13-669');
        expect(cofidLines(sheets, new Set(['13-145']))).toHaveLength(1);
    });

    it.each(['PROT', 'FAT', 'CHO', 'KCALS', 'KJ', 'AOACFIB'])('refuses an edition without the code %s', (code) => {
        const components = COMPONENTS.filter((column) => column.code !== code);

        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([{ key: '13-145' }], components), factors: factorsSheet([]) },
                    new Set(['13-145']),
                ),
            code,
        );
    });

    it('refuses an edition that prints a mapped code twice', () => {
        const components = [...COMPONENTS, { header: 'Protein (g)', code: 'PROT' }];

        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([{ key: '13-145' }], components), factors: factorsSheet([]) },
                    new Set(['13-145']),
                ),
            'PROT',
        );
    });

    it('refuses a mapped column whose header states another unit', () => {
        const components = COMPONENTS.map((column) =>
            column.code === 'PROT' ? { header: 'Protein (mg)', code: 'PROT' } : column,
        );

        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([{ key: '13-145' }], components), factors: factorsSheet([]) },
                    new Set(['13-145']),
                ),
            'Protein (mg)',
        );
    });

    it.each([
        [0, 'Food Code'],
        [1, 'Food Name'],
        [3, 'Group'],
    ])('refuses a Proximates sheet whose column at index %i is not %j', (index, header) => {
        const proximates = proximatesSheet([{ key: '13-145' }]);
        const drifted = [proximates[0]?.map((cell, column) => (column === index ? 'Moved' : cell)) ?? []];

        expectRefused(
            () =>
                cofidLines(
                    { proximates: [...drifted, ...proximates.slice(1)], factors: factorsSheet([]) },
                    new Set(['13-145']),
                ),
            header,
        );
    });

    it.each(['Q', 'QA', 'QC', 'QE', 'QF', 'QG', 'QI', 'QK'])(
        'reads group %s, an alcoholic beverage, per 100 mL with its specific gravity',
        (group) => {
            const lines = cofidLines(
                {
                    proximates: proximatesSheet([{ ...PORT, group }]),
                    factors: factorsSheet([PORT_FACTOR]),
                },
                new Set(['17-234']),
            );

            expect(lines).toEqual([
                {
                    key: '17-234',
                    name: 'Port',
                    basis: 'per100mL',
                    values: PORT_VALUES,
                    densityGramsPerMl: '1.03',
                },
            ]);
        },
    );

    it('reads a food of any other group per 100 g, with no density, even when its Factors row has a gravity', () => {
        const lines = cofidLines(
            {
                proximates: proximatesSheet([{ key: '12-513', name: 'Milk drink', group: 'BAK' }]),
                factors: factorsSheet([{ key: '12-513', name: 'Milk drink', gravity: '1.04' }]),
            },
            new Set(['12-513']),
        );

        expect(lines[0]?.basis).toBe('per100g');
        expect(lines[0]).not.toHaveProperty('densityGramsPerMl');
    });

    it('refuses a group starting with Q that the guide does not list, since its basis is unknown', () => {
        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([{ ...PORT, group: 'QZ' }]), factors: factorsSheet([PORT_FACTOR]) },
                    new Set(['17-234']),
                ),
            'QZ',
        );
    });

    it('refuses a requested food with no group, since its basis is unknown', () => {
        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([{ ...PORT, group: null }]), factors: factorsSheet([PORT_FACTOR]) },
                    new Set(['17-234']),
                ),
            'row 4',
        );
    });

    it('refuses a per-100 mL food whose specific gravity is empty, never guessing one (R54)', () => {
        expectRefused(
            () =>
                cofidLines(
                    {
                        proximates: proximatesSheet([PORT]),
                        factors: factorsSheet([{ ...PORT_FACTOR, gravity: null }]),
                    },
                    new Set(['17-234']),
                ),
            '17-234',
            'specific gravity',
        );
    });

    it('refuses a per-100 mL food that has no Factors row', () => {
        expectRefused(
            () =>
                cofidLines(
                    {
                        proximates: proximatesSheet([PORT]),
                        factors: factorsSheet([{ key: '17-239', name: 'Vermouth, dry', gravity: '1.00' }]),
                    },
                    new Set(['17-234']),
                ),
            '17-234',
        );
    });

    it('refuses a per-100 mL food whose Factors row names another food', () => {
        expectRefused(
            () =>
                cofidLines(
                    {
                        proximates: proximatesSheet([PORT]),
                        factors: factorsSheet([{ ...PORT_FACTOR, name: 'Sherry, medium' }]),
                    },
                    new Set(['17-234']),
                ),
            'Sherry, medium',
        );
    });

    it('refuses a per-100 mL food whose Factors key appears twice', () => {
        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([PORT]), factors: factorsSheet([PORT_FACTOR, PORT_FACTOR]) },
                    new Set(['17-234']),
                ),
            '17-234',
        );
    });

    it('refuses an unknown token in the specific gravity', () => {
        expectRefused(
            () =>
                cofidLines(
                    {
                        proximates: proximatesSheet([PORT]),
                        factors: factorsSheet([{ ...PORT_FACTOR, gravity: 'N' }]),
                    },
                    new Set(['17-234']),
                ),
            'Specific gravity',
        );
    });

    it.each([
        [0, 'Food Code'],
        [1, 'Food Name'],
        [8, 'Specific gravity'],
    ])('refuses a Factors sheet whose column at index %i is not %j', (index, header) => {
        const drifted = FACTORS_HEADER.map((cell, column) => (column === index ? 'Moved' : cell));

        expectRefused(
            () =>
                cofidLines(
                    { proximates: proximatesSheet([PORT]), factors: factorsSheet([PORT_FACTOR], drifted) },
                    new Set(['17-234']),
                ),
            header,
        );
    });
});

describe('cofidExtractor', () => {
    it('reads the table role’s workbook through the xlsx adapter, a trace included', async () => {
        const port: Food = { ...PORT, values: { KCALS: numericCell('157'), KJ: '655', AOACFIB: null, FAT: 'Tr' } };
        const factors = factorsSheet([{ key: '13-145', name: 'Ackee, canned, drained', gravity: null }, PORT_FACTOR]);
        const bytes = await writeXlsxFile([
            { data: sheetData(factors), sheet: '1.2 Factors' },
            { data: sheetData(proximatesSheet([{ key: '13-145' }, port])), sheet: '1.3 Proximates' },
        ]).toBuffer();

        expect(cofidExtractor.roles).toEqual(['table']);
        await expect(
            cofidExtractor.extract(new Map([['table', bytes]]), new Set(['13-145', '17-234'])),
        ).resolves.toEqual([
            { key: '13-145', name: 'Ackee, canned, drained', basis: 'per100g', values: DEFAULT_VALUES },
            {
                key: '17-234',
                name: 'Port',
                basis: 'per100mL',
                values: { PROCNT: '2.9', CHOAVLM: '0.8', ENERC_KCAL: '157', ENERC_KJ: '655' },
                traces: ['FAT'],
                densityGramsPerMl: '1.03',
            },
        ]);
    });

    it('refuses upstreams without the table role', async () => {
        await expect(cofidExtractor.extract(new Map([['other', Buffer.from('x')]]), new Set())).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError' }),
        );
    });
});
