/**
 * One sheet of a published workbook as rows of table cells (plan U23).
 *
 * @pattern Adapter over read-excel-file — a workbook's sheet becomes `TableCell` rows
 *
 * It reads through read-excel-file's `universal` build, which unzips from the central directory, and never through its
 * `node` build, which streams the zip and trusts each entry's local header. Livsmedelsverket generates its workbook per
 * download, and every entry sets general-purpose bit 3, states its sizes in its local header anyway, and follows its
 * data with a data descriptor: the streaming reader meets the descriptor's signature where it expects the next entry
 * and refuses a valid workbook. The bytes are already in memory, so nothing is lost by not streaming them.
 *
 * A number cell stays a `NumericCell`, so a key stored as a number is visible as one (`keyOf` refuses it). Its text
 * is the number at the 15 significant digits Excel keeps ("Number precision: 15 digits", Microsoft's "Excel
 * specifications and limits"), which is the figure Excel shows. A workbook stores a double, and its writer may
 * serialize it to 17 digits: CoFID 2021 stores a typed 2.3 as `2.2999999999999998` in 55 of its mapped cells, and
 * a sum such as 1.8 as `1.7999999999999998`. Reading at Excel's own precision recovers the figure the publisher
 * typed and showed. It is not a conversion. A formula whose value the workbook does not hold reads as empty, as
 * read-excel-file documents, so a table that relies on formulas reads as no value rather than a wrong one.
 *
 * @module
 */
import type { Buffer } from 'node:buffer';

import { readSheet, type SheetData } from 'read-excel-file/universal';

import { numericCell, type NumericCell, type TableCell } from './tableCell.js';
import { TableFormatError } from './tableExtract.errors.js';

/** The significant digits Excel keeps for a number. */
const EXCEL_PRECISION = 15;

/**
 * A stored number at the precision Excel keeps, in its shortest decimal form. Pure.
 *
 * @param stored - The number's text as the workbook stores it.
 * @returns The cell. A text that is no finite number keeps its text, so the value rules refuse it by name.
 */
function excelNumber(stored: string): NumericCell {
    const value = Number(stored);

    return numericCell(Number.isFinite(value) ? String(Number(value.toPrecision(EXCEL_PRECISION))) : stored);
}

/**
 * Read one sheet. Pure; async only because the reader is.
 *
 * @param bytes - The workbook's bytes, already checked against their pin.
 * @param sheet - The sheet's name.
 * @returns Its rows, each a list of cells.
 * @throws {TableFormatError} when the bytes are not a workbook, the sheet is absent, or a cell is a date or a boolean.
 */
export async function readXlsxSheet(bytes: Buffer, sheet: string): Promise<TableCell[][]> {
    let rows: SheetData<NumericCell>;

    try {
        // A copy as a plain `ArrayBuffer`, which is what the universal build reads.
        rows = await readSheet<NumericCell>(new Uint8Array(bytes).buffer, sheet, {
            parseNumber: excelNumber,
            trim: false,
        });
    } catch (error) {
        // The reader's own message names the sheets a workbook has when the one asked for is absent.
        throw new TableFormatError(sheet, error instanceof Error ? error.message : 'not a workbook');
    }

    return rows.map((row, rowIndex) =>
        row.map((cell, column): TableCell => {
            if (cell === null || typeof cell === 'string' || (typeof cell === 'object' && 'numeric' in cell)) {
                return cell;
            }

            throw new TableFormatError(
                `${sheet}, row ${String(rowIndex + 1)}, column ${String(column + 1)}`,
                `holds a ${cell instanceof Date ? 'date' : typeof cell}, which no food table prints`,
            );
        }),
    );
}
