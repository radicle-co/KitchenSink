/**
 * The cell rules every table extractor shares (plan U23, KTD-24). A table cell is text, a number the spreadsheet
 * stored as one, or empty. A key must be text. A value cell is the table's own decimal, one of its marks for a trace
 * or a below-limit bound, or one of its marks for "not known". Every other cell is refused: an extractor that meets a
 * cell it does not recognise is reading a layout it was never written for, and guessing would store a wrong number
 * with a citation. A trace is kept apart from "not known", for the reason `ExtractLine.traces` gives.
 *
 * @pattern Value Object — `NumericCell` keeps a spreadsheet number as the exact text the file stores
 * @pattern Visitor — `lineAmounts` switches over every kind of the `AmountReading` discriminated union
 * @module
 */
import type { InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import { isExtractDecimal, type ExtractLine } from './sourceExtract.js';
import { TableFormatError } from './tableExtract.errors.js';

/** A number a spreadsheet stored as one, kept as the exact text in the file, never as a float. */
export interface NumericCell {
    readonly numeric: string;
}

/** One cell of an upstream table. CSV and XML cells are always text. */
export type TableCell = string | NumericCell | null;

/** The rows of one sheet or file. */
export type TableRows = readonly (readonly TableCell[])[];

/** How one table writes a value it does not give as a number. Marks are read in text cells only. */
export interface AmountMarks {
    /** The table's marks for "not known", compared after trimming. An empty cell is the mark `''`. */
    readonly absent: readonly string[];
    /** The table's marks for a trace, compared after trimming: the nutrient is present below what the table prints. */
    readonly trace?: readonly string[];
    /**
     * A bound the table prints in place of an amount below its limit, such as CIQUAL's `< 0,5`, read as a trace. A
     * pattern, because the limit varies; it must be anchored and carry no `g` or `y` flag, since `test` would then
     * keep state between cells.
     */
    readonly tracePattern?: RegExp;
    /**
     * Whether the table writes a decimal comma (`31,7`). Such a table never writes a decimal point, so a text with one
     * is refused: `1.586` there can only be a thousands separator, and reading it as a fraction is a silent error.
     */
    readonly decimalComma?: boolean;
}

/**
 * A spreadsheet number cell. Pure.
 *
 * @param text - The number exactly as the file stores it.
 * @returns The cell.
 */
export function numericCell(text: string): NumericCell {
    return { numeric: text };
}

/**
 * A cell of a row, read as empty past the row's end, where a spreadsheet leaves trailing empty cells out. Pure.
 *
 * @param row - The row.
 * @param index - The column.
 * @returns The cell.
 */
export function cellAt(row: readonly TableCell[], index: number): TableCell {
    return row.at(index) ?? null;
}

/**
 * A cell's text, trimmed, with an empty cell read as `''`. Pure.
 *
 * @param cell - The cell.
 * @returns Its text.
 */
function textOf(cell: TableCell): string {
    if (cell === null) {
        return '';
    }

    return (typeof cell === 'string' ? cell : cell.numeric).trim();
}

/**
 * Read a key cell. Pure.
 *
 * @param cell - The cell.
 * @param where - The row, for the refusal.
 * @returns The key exactly as the table prints it, trimmed.
 * @throws {TableFormatError} when the cell is empty, or a number: a number has already lost the zeros that make
 *   `01001` and `06.530` the keys they are.
 */
export function keyOf(cell: TableCell, where: string): string {
    if (cell !== null && typeof cell !== 'string') {
        throw new TableFormatError(where, `the key ${cell.numeric} is stored as a number, so its zeros are lost`);
    }

    const key = textOf(cell);

    if (key === '') {
        throw new TableFormatError(where, 'has no key');
    }

    return key;
}

/** What a value cell says: the table's number, a trace, or nothing known. */
export type AmountReading =
    { readonly kind: 'value'; readonly value: string } | { readonly kind: 'trace' } | { readonly kind: 'absent' };

/**
 * Read a value cell. This is the one place a cell is classified, so every table reads its marks the same way. Pure.
 *
 * @param cell - The cell.
 * @param where - The row and column, for the refusal.
 * @param marks - The table's own marks.
 * @returns The value as a plain decimal, a trace for one of the table's trace marks or bounds, or absent for one of
 *   its "not known" marks.
 * @throws {TableFormatError} when the cell is neither a decimal of at most three places nor a mark of this table.
 */
export function readAmount(cell: TableCell, where: string, marks: AmountMarks): AmountReading {
    const text = textOf(cell);

    if (typeof cell === 'string' || cell === null) {
        if (marks.absent.includes(text)) {
            return { kind: 'absent' };
        }

        if (marks.trace?.includes(text) === true || marks.tracePattern?.test(text) === true) {
            return { kind: 'trace' };
        }
    }

    const commaText = marks.decimalComma === true && typeof cell === 'string';

    if (commaText && text.includes('.')) {
        throw new TableFormatError(where, `'${text}' holds a decimal point, and this table writes a decimal comma`);
    }

    const decimal = commaText ? text.replace(',', '.') : text;

    if (!isExtractDecimal(decimal)) {
        throw new TableFormatError(where, `'${text}' is no decimal of at most three places and no mark of this table`);
    }

    return { kind: 'value', value: decimal };
}

/** An entry's amounts, as its extract line holds them. */
export type LineAmounts = Pick<ExtractLine, 'values' | 'traces'>;

/**
 * Fold an entry's readings into its extract line's values and traces. Every extractor goes through here, so a table
 * that gains a trace mark keeps its traces without another change. Pure.
 *
 * @param readings - Each mapped tag's reading. A map, so a tag is read once.
 * @returns The values by tag, and the traces in reading order; no `traces` field when there are none, which is how
 *   the extract writes it.
 */
export function lineAmounts(readings: ReadonlyMap<InfoodsTag, AmountReading>): LineAmounts {
    const valueEntries: [InfoodsTag, string][] = [];
    const traces: InfoodsTag[] = [];

    for (const [tag, reading] of readings) {
        switch (reading.kind) {
            case 'value':
                valueEntries.push([tag, reading.value]);
                break;
            case 'trace':
                traces.push(tag);
                break;
            case 'absent':
                break;

            default: {
                const unreachable: never = reading;

                throw new Error(`unhandled amount reading '${JSON.stringify(unreachable)}'`);
            }
        }
    }

    // Built from entries, never a literal accumulator, so no key can reach the inherited `__proto__` setter.
    const values: Partial<Record<InfoodsTag, string>> = Object.fromEntries(valueEntries);

    return traces.length === 0 ? { values } : { values, traces };
}
