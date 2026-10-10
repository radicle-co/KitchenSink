/**
 * Livsmedelsdatabasen, the Swedish Food Composition Database, as extract lines (plan U23, KTD-20, R53; ADR-0052 §8).
 *
 * The upstream is the publisher's whole-table workbook, the "Ladda ner Livsmedelsdatabasen" download on
 * soknaringsinnehall.livsmedelsverket.se. Its one sheet holds a title row naming the database's version, a row stating
 * that every value is "per 100 gram livsmedel", a header row, then one row per food. The columns are named only by
 * header text, so the exact header is asserted at every mapped column. The version must be the register's edition,
 * because the register's attribution names it.
 *
 * The headers name no method, so each definition below is the one the publisher's API states for the same component,
 * and the values agree: every mapped value of the 38 candidate foods equals the API's on 2026-10-01, except two that
 * differ only by the value type the workbook does not print (below).
 *
 * - `Energi (kJ)` and `Energi (kcal)`: energy by the EU 1169/2011 factors, kcal derived from kJ.
 * - `Protein (g)`: protein calculated from protein nitrogen, read as `PROCNT`. `Fett, totalt (g)`: total fat, `FAT`.
 * - `Fiber (g)`: total dietary fibre by the AOAC methods, `FIBTG`.
 * - `Kolhydrater, tillgängliga (g)`: available carbohydrate calculated by difference (EuroFIR MI0183), 100 g less water,
 *   ash, protein, fat, fibre and alcohol. That is INFOODS `CHOAVLDF`, a definition of its own (R53), never `CHOAVL`.
 *
 * ⚠️ The workbook stores every value as a number and carries no value type. A logical zero, a value below the limit of
 * detection or of quantification, and a measured zero all print 0, so a 0 is read as the value 0 and the extract
 * holds no trace. The API marks Kvarg naturell's fibre (3243) and frozen mango's fat (5135) as below a limit, and the
 * workbook prints both as 0. R53 counts a trace of carbohydrate or fibre as 0 anyway, so no total moves.
 *
 * The workbook's names are Swedish. The API's English names are not in it.
 *
 * @pattern Strategy — the `livsmedelsverket` table extractor
 * @module
 */
import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import { SOURCE_REGISTER } from '../../../sources/sourceRegister.js';
import type { ExtractLine } from './sourceExtract.js';
import { cellAt, lineAmounts, readAmount, type AmountMarks, type TableCell, type TableRows } from './tableCell.js';
import { TableFormatError } from './tableExtract.errors.js';
import { upstreamOf, type TableExtractor } from './tableExtractor.js';
import { readXlsxSheet } from './xlsxSheet.js';

/** The workbook's one sheet. */
const SHEET = 'Blad1';

/** The role the workbook is pinned under. */
const TABLE = 'table';

/** The title row: the database's version, which the register's attribution names. */
const TITLE = `Livsmedelsverkets livsmedelsdatabas version ${SOURCE_REGISTER.livsmedelsverket.edition}`;

/** The basis row: every value per 100 g of the food, drinks included. */
const BASIS = 'Näringsinnehåll per 100 gram livsmedel';

/** The header row's index; the food rows follow it. */
const HEADER_ROW = 2;

const NAME = { index: 0, header: 'Livsmedelsnamn' } as const;
const KEY = { index: 1, header: 'Livsmedelsnummer' } as const;
const GROUP = { index: 2, header: 'Gruppering' } as const;

/** Each mapped column: its index, its exact header, and the INFOODS tag of its definition (R53). */
const COLUMNS: readonly { readonly index: number; readonly header: string; readonly tag: InfoodsTag }[] = [
    { index: 3, header: 'Energi (kcal)', tag: INFOODS.energyKcal },
    { index: 4, header: 'Energi (kJ)', tag: INFOODS.energyKj },
    { index: 5, header: 'Fett, totalt (g)', tag: INFOODS.fat },
    { index: 6, header: 'Protein (g)', tag: INFOODS.protein },
    { index: 7, header: 'Kolhydrater, tillgängliga (g)', tag: INFOODS.carbohydrateAvailableByDifference },
    { index: 8, header: 'Fiber (g)', tag: INFOODS.fibre },
];

/** An empty cell is no value. The workbook prints no other mark. */
const MARKS: AmountMarks = { absent: [''] };

/** A food number: a positive integer, which the workbook stores as a number. */
const FOOD_NUMBER = /^[1-9][0-9]*$/u;

/**
 * Assert that a preamble cell holds exactly the expected text. Pure.
 *
 * @param rows - The sheet.
 * @param row - The row's index.
 * @param column - The column's index.
 * @param expected - The text.
 * @throws {TableFormatError} naming the row and column when the cell differs.
 */
function expectCell(rows: TableRows, row: number, column: number, expected: string): void {
    const cell = cellAt(rows[row] ?? [], column);

    if (cell !== expected) {
        throw new TableFormatError(
            `${SHEET}, row ${String(row + 1)}, column ${String(column + 1)}`,
            `holds ${JSON.stringify(cell)}, not '${expected}'`,
        );
    }
}

/**
 * Read a food number. Pure.
 *
 * @param cell - The `Livsmedelsnummer` cell.
 * @param where - The row, for the refusal.
 * @returns The number as text, the form the candidates name it in.
 * @throws {TableFormatError} when the cell is not a number, or not a positive integer.
 */
function foodNumberOf(cell: TableCell, where: string): string {
    if (cell === null || typeof cell === 'string') {
        throw new TableFormatError(where, `the food number ${JSON.stringify(cell)} is not stored as a number`);
    }

    if (!FOOD_NUMBER.test(cell.numeric)) {
        throw new TableFormatError(where, `${cell.numeric} is not a food number`);
    }

    return cell.numeric;
}

/**
 * Read a value cell. Pure.
 *
 * @param cell - The cell.
 * @param where - The row and column, for the refusal.
 * @returns The reading.
 * @throws {TableFormatError} when the cell is text, which this workbook never prints in a value column, or a number
 *   that is negative or longer than three places.
 */
function valueOf(cell: TableCell, where: string): ReturnType<typeof readAmount> {
    if (typeof cell === 'string') {
        throw new TableFormatError(where, `holds the text '${cell}', and this workbook stores every value as a number`);
    }

    return readAmount(cell, where, MARKS);
}

/**
 * The extract lines of the requested foods. Every value is per 100 g, drinks included. Pure.
 *
 * @param rows - The workbook's one sheet.
 * @param keys - The requested food numbers.
 * @returns One line per requested number the table holds. A number it does not hold is left out.
 * @throws {TableFormatError} when the title is not the register's edition, the basis is not per 100 g, a mapped header
 *   differs, a row's food number is not one, a requested food's name is not text or is blank, a requested number is
 *   held twice, or a requested food holds a cell this extractor does not read.
 */
export function livsmedelsverketLines(rows: TableRows, keys: ReadonlySet<string>): ExtractLine[] {
    expectCell(rows, 0, 0, TITLE);
    expectCell(rows, 1, 0, BASIS);

    for (const column of [NAME, KEY, GROUP, ...COLUMNS]) {
        expectCell(rows, HEADER_ROW, column.index, column.header);
    }

    const lines = new Map<string, ExtractLine>();

    for (const [offset, row] of rows.slice(HEADER_ROW + 1).entries()) {
        const where = `${SHEET}, row ${String(offset + HEADER_ROW + 2)}`;
        const key = foodNumberOf(cellAt(row, KEY.index), where);

        if (!keys.has(key)) {
            continue;
        }

        const name = cellAt(row, NAME.index);

        if (typeof name !== 'string' || name.trim() === '') {
            throw new TableFormatError(where, `food ${key} has no name as text`);
        }

        if (lines.has(key)) {
            throw new TableFormatError(where, `${key} is held twice, so it names no one food`);
        }

        const readings = new Map(
            COLUMNS.map((column) => [column.tag, valueOf(cellAt(row, column.index), `${where}, ${column.header}`)]),
        );

        lines.set(key, { key, name: name.trim(), basis: 'per100g', ...lineAmounts(readings) });
    }

    return [...lines.values()];
}

/** The Livsmedelsdatabasen extractor: the whole-table workbook, under the role `table`. */
export const livsmedelsverketExtractor: TableExtractor = {
    roles: [TABLE],
    async extract(upstreams, keys) {
        const bytes = upstreamOf(upstreams, TABLE);

        return livsmedelsverketLines(await readXlsxSheet(bytes, SHEET), keys);
    },
};
