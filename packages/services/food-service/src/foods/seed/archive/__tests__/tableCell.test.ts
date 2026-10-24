/**
 * The cell rules every table extractor shares (plan U23, KTD-24): a key is text, exactly as the table prints it, and a
 * value cell is the table's own decimal, one of its marks for a trace or a below-limit bound, or one of its marks for
 * "not known". Anything else is refused, because a cell an extractor does not recognise is a layout it was never
 * written for. A trace is kept apart from "not known" because R53's total carbohydrate counts it as 0.
 */
import { describe, expect, it } from 'vitest';

import { isTableFormatError } from '../tableExtract.errors.js';
import {
    cellAt,
    keyOf,
    lineAmounts,
    numericCell,
    readAmount,
    type AmountMarks,
    type AmountReading,
    type TableCell,
} from '../tableCell.js';

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

describe('keyOf', () => {
    it.each([
        ['01001', '01001'],
        ['06.530', '06.530'],
        ['  13-145 ', '13-145'],
    ])('reads the text key %j as %j', (cell, key) => {
        expect(keyOf(cell, 'row 1')).toBe(key);
    });

    it('refuses a key stored as a number, which has already lost its leading and trailing zeros', () => {
        const error = thrown(() => keyOf(numericCell('6.53'), 'row 4'));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('row 4');
    });

    it.each([null, '', '   '])('refuses an empty key %j', (cell) => {
        expect(isTableFormatError(thrown(() => keyOf(cell, 'row 1')))).toBe(true);
    });
});

/**
 * The reading of each kind of cell. This replaces `amountOf`, which read a trace as no value: a trace is now its own
 * reading, so these tests prove the three outcomes apart and the refusal of a mark the table does not print.
 */
describe('readAmount', () => {
    const marks: AmountMarks = { absent: ['N', ''], trace: ['Tr', '(Tr)'] };

    it.each<[TableCell, string]>([
        ['12.4', '12.4'],
        [' 0 ', '0'],
        [numericCell('1070'), '1070'],
        [numericCell('0.25'), '0.25'],
    ])('reads %j as the value %j', (cell, value) => {
        expect(readAmount(cell, 'row 1', marks)).toEqual({ kind: 'value', value });
    });

    it.each<TableCell>(['N', null, '  '])('reads the table’s "not known" mark %j as absent', (cell) => {
        expect(readAmount(cell, 'row 1', marks)).toEqual({ kind: 'absent' });
    });

    it.each<TableCell>(['Tr', ' Tr ', '(Tr)'])('reads the table’s trace mark %j as a trace', (cell) => {
        expect(readAmount(cell, 'row 1', marks)).toEqual({ kind: 'trace' });
    });

    it('reads a text the table’s trace pattern matches as a trace, and a value beside it as a value', () => {
        const bounded: AmountMarks = { absent: ['-'], tracePattern: /^< ?\d+(,\d+)?$/u, decimalComma: true };

        expect(readAmount('< 0,5', 'row 1', bounded)).toEqual({ kind: 'trace' });
        expect(readAmount(' <10 ', 'row 1', bounded)).toEqual({ kind: 'trace' });
        expect(readAmount('0,5', 'row 1', bounded)).toEqual({ kind: 'value', value: '0.5' });
        expect(readAmount('-', 'row 1', bounded)).toEqual({ kind: 'absent' });
    });

    it('reads a mark only in a text cell: a stored number is always a number', () => {
        const zeroIsTrace: AmountMarks = { absent: [], trace: ['0'], tracePattern: /^0$/u };

        expect(readAmount('0', 'row 1', zeroIsTrace)).toEqual({ kind: 'trace' });
        expect(readAmount(numericCell('0'), 'row 1', zeroIsTrace)).toEqual({ kind: 'value', value: '0' });
    });

    it('reads a decimal comma when the table prints one', () => {
        expect(readAmount('31,7', 'row 1', { absent: [], decimalComma: true })).toEqual({
            kind: 'value',
            value: '31.7',
        });
    });

    it('refuses a decimal point in a decimal-comma table, where 1.586 can only be a thousands separator', () => {
        expect(isTableFormatError(thrown(() => readAmount('1.586', 'row 1', { absent: [], decimalComma: true })))).toBe(
            true,
        );
    });

    it.each<[TableCell, AmountMarks]>([
        ['31,7', marks],
        ['-1', marks],
        ['1e3', marks],
        ['(0.1)', marks],
        ['traces', marks],
        ['tr', marks],
        ['< 0,5', marks],
        [numericCell('1.2000000000000002'), marks],
        [numericCell('-0.5'), marks],
        ['Tr', { absent: ['N', ''] }],
        ['', { absent: [], trace: ['Tr'] }],
    ])('refuses %j, which is no decimal and no mark of this table', (cell, tableMarks) => {
        const error = thrown(() => readAmount(cell, 'row 9, Fat', tableMarks));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('row 9, Fat');
    });
});

describe('lineAmounts', () => {
    it('puts each value under its tag and each trace in the traces, and drops what is absent', () => {
        const readings = new Map<'FAT' | 'FIBTG' | 'PROCNT' | 'CHOAVL', AmountReading>([
            ['PROCNT', { kind: 'value', value: '2.9' }],
            ['FIBTG', { kind: 'trace' }],
            ['FAT', { kind: 'absent' }],
            ['CHOAVL', { kind: 'trace' }],
        ]);

        expect(lineAmounts(readings)).toEqual({ values: { PROCNT: '2.9' }, traces: ['FIBTG', 'CHOAVL'] });
    });

    it('gives no traces field at all when nothing is a trace', () => {
        const amounts = lineAmounts(
            new Map<'FAT' | 'PROCNT', AmountReading>([
                ['PROCNT', { kind: 'value', value: '2.9' }],
                ['FAT', { kind: 'absent' }],
            ]),
        );

        expect(amounts).toEqual({ values: { PROCNT: '2.9' } });
        expect(amounts).not.toHaveProperty('traces');
    });
});

describe('cellAt', () => {
    it('reads a cell inside the row, and a cell past its end as empty', () => {
        const row: TableCell[] = ['01001', numericCell('343')];

        expect(cellAt(row, 0)).toBe('01001');
        expect(cellAt(row, 1)).toEqual(numericCell('343'));
        expect(cellAt(row, 5)).toBeNull();
    });
});
