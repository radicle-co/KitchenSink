/**
 * Matvaretabellen 2026, the Norwegian Food Composition Table, as extract lines (plan U23, KTD-20, R53). The Foods
 * sheet names its columns only by header text, so the exact header is asserted at every mapped column. Definitions
 * are quoted from the Norwegian Food Safety Authority's "Definitions of nutrients" page (mattilsynet.no, last reviewed
 * 13.01.2026), which gives each nutrient's INFOODS code.
 *
 * @pattern Strategy — the `matvaretabellen` table extractor
 * @module
 */
import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import type { ExtractLine } from './sourceExtract.js';
import {
    cellAt,
    keyOf,
    lineAmounts,
    readAmount,
    type AmountMarks,
    type TableCell,
    type TableRows,
} from './tableCell.js';
import { TableFormatError } from './tableExtract.errors.js';
import { upstreamOf, type TableExtractor } from './tableExtractor.js';
import { readXlsxSheet } from './xlsxSheet.js';

const FOODS = 'Foods';

const KEY = { index: 0, header: 'Matvare ID' } as const;
const NAME = { index: 1, header: 'Matvare' } as const;

/** Each mapped column: its index, its exact header, and the INFOODS tag the publisher gives its definition (R53). */
const COLUMNS: readonly { readonly index: number; readonly header: string; readonly tag: InfoodsTag }[] = [
    { index: 4, header: 'Kilojoule (kJ)', tag: INFOODS.energyKj },
    { index: 5, header: 'Kilokalorier (kcal)', tag: INFOODS.energyKcal },
    { index: 6, header: 'Fat (g)', tag: INFOODS.fat },
    // "Carbohydrates are calculated as the sum of starch and sugars", INFOODS CHOAVL, and "Dietary fiber is not
    // included in carbohydrates". The workbook's own Source Lookup agrees: MI0181, "Carbohydrate, available".
    { index: 7, header: 'Carbohydrate (g)', tag: INFOODS.carbohydrateAvailable },
    { index: 8, header: 'Dietary fibre (g)', tag: INFOODS.fibre },
    { index: 9, header: 'Protein (g)', tag: INFOODS.protein },
];

/** The 2026 workbook writes no value as an empty cell, and as nothing else. It prints no trace mark. */
const MARKS: AmountMarks = { absent: [''], decimalComma: true };

/**
 * Whether a cell is empty or blank. Pure.
 *
 * @param cell - The cell.
 * @returns True for an empty cell or blank text.
 */
function isEmpty(cell: TableCell): boolean {
    return cell === null || (typeof cell === 'string' && cell.trim() === '');
}

/**
 * The extract lines of the requested foods. Every food is per 100 g, drinks included: "the content of alcohol is
 * converted to a percentage by weight, i.e. grams per 100 g of drink". Pure.
 *
 * @param rows - The Foods sheet.
 * @param keys - The requested Matvare IDs.
 * @returns One line per requested ID the table holds. An ID it does not hold is left out.
 * @throws {TableFormatError} when a mapped header differs, a key is numeric, a row has values but no name, a
 *   requested key is held twice, or a requested food holds a cell this extractor does not read.
 */
export function matvaretabellenLines(rows: TableRows, keys: ReadonlySet<string>): ExtractLine[] {
    const header = rows[0] ?? [];

    for (const column of [KEY, NAME, ...COLUMNS]) {
        const cell = cellAt(header, column.index);

        if (cell !== column.header) {
            throw new TableFormatError(
                `${FOODS}, row 1, column ${String(column.index + 1)}`,
                `holds ${JSON.stringify(cell)}, not '${column.header}'`,
            );
        }
    }

    const lines = new Map<string, ExtractLine>();

    for (const [offset, row] of rows.slice(1).entries()) {
        const where = `${FOODS}, row ${String(offset + 2)}`;
        const name = cellAt(row, NAME.index);

        // A food group's heading holds its name and nothing else. An empty edible part does not make a heading: many
        // foods of the 2026 table, from butter chicken to moose, print one.
        if (isEmpty(name)) {
            if (!row.slice(1).every(isEmpty)) {
                throw new TableFormatError(where, 'holds values but no food name');
            }

            continue;
        }

        const key = keyOf(cellAt(row, KEY.index), where);

        if (typeof name !== 'string') {
            throw new TableFormatError(where, 'holds a food name stored as a number');
        }

        if (!keys.has(key)) {
            continue;
        }

        if (lines.has(key)) {
            throw new TableFormatError(where, `${key} is held twice, so it names no one food`);
        }

        const readings = new Map(
            COLUMNS.map((column) => [
                column.tag,
                readAmount(cellAt(row, column.index), `${where}, ${column.header}`, MARKS),
            ]),
        );

        lines.set(key, { key, name: name.trim(), basis: 'per100g', ...lineAmounts(readings) });
    }

    return [...lines.values()];
}

/** The Matvaretabellen 2026 extractor: one workbook, under the role `table`. */
export const matvaretabellenExtractor: TableExtractor = {
    roles: ['table'],
    async extract(upstreams, keys) {
        const bytes = upstreamOf(upstreams, 'table');

        return matvaretabellenLines(await readXlsxSheet(bytes, FOODS), keys);
    },
};
