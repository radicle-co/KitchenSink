/**
 * The Standard Tables of Food Composition in Japan's extractor (plan U23, KTD-20, KTD-24): MEXT's 2020 (8th) edition
 * with its 2023 supplement, read from the `表全体` (whole table) sheet of the chapter 2 workbook. Every value is per
 * 100 g of edible portion, which the sheet's own header states and the extractor asserts.
 *
 * @pattern Strategy — the Japan `TableExtractor`
 *
 * A component column is found only by MEXT's component identifier in row 12 (`成分識別子`), each mapped identifier
 * exactly once, so a re-laid-out edition fails loudly instead of shifting a column. Identifiers MEXT prints that are
 * NOT read: `PROTCAA` (protein as amino-acid residues), `FATNLEA` (fat as triacylglycerol equivalents) and
 * `CHOAVLDF-` (available carbohydrate by difference) are other definitions, and the two unlabelled columns hold `*`
 * flags. The key and the name sit at fixed columns whose only identity is their header caption, so those captions are
 * asserted.
 *
 * @module
 */

import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import type { ExtractLine } from './sourceExtract.js';
import { keyOf, lineAmounts, readAmount, type AmountMarks, type AmountReading, type TableCell } from './tableCell.js';
import { TableFormatError } from './tableExtract.errors.js';
import { upstreamOf, type TableExtractor } from './tableExtractor.js';
import { readXlsxSheet } from './xlsxSheet.js';

/** The sheet that holds every food. */
const SHEET = '表全体';

/** A full-width space, as MEXT spaces out its header captions. */
const W = '\u3000';

/** Row 11 (0-based 10): each column's unit. */
const UNIT_ROW = 10;

/** Row 12 (0-based 11): each column's component identifier. */
const IDENTIFIER_ROW = 11;

/** Row 13 (0-based 12): the first food. */
const FIRST_FOOD_ROW = 12;

/** Column 2 (0-based 1): the food number. */
const KEY_COLUMN = 1;

/** Column 4 (0-based 3): the food name. */
const NAME_COLUMN = 3;

/** The header cells that give the fixed columns and the basis their meaning, as [row, column, caption] (0-based). */
const CAPTIONS: readonly (readonly [number, number, string])[] = [
    [1, KEY_COLUMN, `食${W}品${W}番${W}号`],
    [1, NAME_COLUMN, `可${W}${W}食${W}${W}部${W}${W} 100${W}${W}g${W}${W}当${W}${W}た${W}${W}り`],
    [2, NAME_COLUMN, `食${W}品${W}名`],
    [IDENTIFIER_ROW, NAME_COLUMN, '成分識別子'],
];

/** The components read, by MEXT's identifier, with the INFOODS tag of each one's definition. */
const COMPONENTS: ReadonlyMap<string, InfoodsTag> = new Map([
    ['ENERC', INFOODS.energyKj],
    ['ENERC_KCAL', INFOODS.energyKcal],
    ['PROT-', INFOODS.protein],
    ['FAT-', INFOODS.fat],
    ['CHOCDF-', INFOODS.carbohydrateByDifference],
    ['CHOAVL', INFOODS.carbohydrateAvailable],
    ['CHOAVLM', INFOODS.carbohydrateAvailableMonosaccharides],
    ['FIB-', INFOODS.fibre],
]);

/** `ENERC` is energy in either unit; row 11 says which, so both energy columns' units are asserted. */
const ENERGY_UNITS: ReadonlyMap<string, string> = new Map([
    ['ENERC', 'kJ'],
    ['ENERC_KCAL', 'kcal'],
]);

/**
 * MEXT's marks (2023 supplement, chapter 1, p. 33 of the PDF): `-` is not measured; `Tr` is a trace and `(Tr)` an
 * estimated trace, below half the smallest amount the table prints.
 */
const MARKS: AmountMarks = { absent: ['-'], trace: ['Tr', '(Tr)'] };

/**
 * A number in parentheses. MEXT prints a value in parentheses when it was estimated: borrowed from another country's
 * table, computed from a recipe, inferred from a similar food, or `(0)` for a component presumed absent and not
 * measured (2023 supplement, chapter 1, p. 33 of the PDF: "推定値として「(0)」と表示した", "（ ）を付けて数値を
 * 示した"). It is the table's own published value, so the number inside is read.
 */
const ESTIMATE = /^\((\d+(?:\.\d+)?)\)$/u;

/**
 * Read one value cell: an estimate's parentheses come off, then the cell is read as any table's cell. Pure.
 *
 * @param cell - The cell.
 * @param where - The row and identifier, for the refusal.
 * @returns The value as a plain decimal, a trace, or absent for `-`.
 * @throws {TableFormatError} when the cell is no number, estimate or mark MEXT prints.
 */
function valueOf(cell: TableCell, where: string): AmountReading {
    if (typeof cell === 'string') {
        const estimate = ESTIMATE.exec(cell.trim());

        return readAmount(estimate === null ? cell : estimate[1], where, MARKS);
    }

    return readAmount(cell, where, MARKS);
}

/**
 * The text of a header cell, for comparison. Pure.
 *
 * @param rows - The sheet.
 * @param row - The row (0-based).
 * @param column - The column (0-based).
 * @returns The cell's text, or `undefined` when it is not text.
 */
function captionAt(rows: readonly (readonly TableCell[])[], row: number, column: number): string | undefined {
    const cell = rows[row]?.[column];

    return typeof cell === 'string' ? cell : undefined;
}

/** A mapped component's column. */
interface ComponentColumn {
    /** MEXT's identifier. */
    readonly identifier: string;
    /** The INFOODS tag of its definition. */
    readonly tag: InfoodsTag;
    /** Its column (0-based). */
    readonly column: number;
}

/**
 * Find each mapped component's column by its identifier, after asserting the captions. Pure.
 *
 * @param rows - The sheet.
 * @returns Each mapped component's column.
 * @throws {TableFormatError} when a caption differs, a mapped identifier is not in row 12 exactly once, or an energy
 *   column's unit is not the one its identifier names.
 */
function componentColumns(rows: readonly (readonly TableCell[])[]): ComponentColumn[] {
    for (const [row, column, caption] of CAPTIONS) {
        if (captionAt(rows, row, column) !== caption) {
            throw new TableFormatError(
                `${SHEET}, row ${String(row + 1)}, column ${String(column + 1)}`,
                `reads '${captionAt(rows, row, column) ?? ''}', not '${caption}'`,
            );
        }
    }

    const identifiers = (rows[IDENTIFIER_ROW] ?? []).map((cell) => (typeof cell === 'string' ? cell.trim() : ''));

    return [...COMPONENTS].map(([identifier, tag]) => {
        const found = identifiers.flatMap((text, column) => (text === identifier ? [column] : []));
        const [column] = found;

        if (found.length !== 1 || column === undefined) {
            throw new TableFormatError(
                `${SHEET}, row 12`,
                `names the component ${identifier} ${String(found.length)} times, not once`,
            );
        }

        const unit = ENERGY_UNITS.get(identifier);

        if (unit !== undefined && captionAt(rows, UNIT_ROW, column) !== unit) {
            throw new TableFormatError(`${SHEET}, row 11, ${identifier}`, `is not in ${unit}`);
        }

        return { identifier, tag, column };
    });
}

/** A food number: five digits, the first two its food group. */
const FOOD_NUMBER = /^\d{5}$/u;

/**
 * Map the sheet's rows to extract lines. Pure.
 *
 * Only a requested row's values are read. Row 03032 (reduced starch syrup) prints `18.5†`, a value MEXT flags as
 * "measured by the prescribed method" for a sugar alcohol whose method reads it as starch; it is no number this
 * extractor stores, and reading every row would refuse the whole table for a food nobody cites.
 *
 * @param rows - The `表全体` sheet's rows.
 * @param keys - The requested food numbers.
 * @returns The line of every requested food the table holds, in the table's order.
 * @throws {TableFormatError} when the header is not MEXT's layout, a food number is not five digits of text or is
 *   listed twice, a requested food has no name, or a requested value is no form MEXT prints.
 */
export function stfcjLines(rows: readonly (readonly TableCell[])[], keys: ReadonlySet<string>): ExtractLine[] {
    const columns = componentColumns(rows);
    const seen = new Set<string>();
    const lines: ExtractLine[] = [];

    for (const [index, row] of rows.slice(FIRST_FOOD_ROW).entries()) {
        const where = `${SHEET}, row ${String(FIRST_FOOD_ROW + index + 1)}`;
        const key = keyOf(row[KEY_COLUMN] ?? null, where);

        if (!FOOD_NUMBER.test(key)) {
            throw new TableFormatError(where, `the food number '${key}' is not five digits`);
        }

        if (seen.has(key)) {
            throw new TableFormatError(where, `lists the food ${key} a second time`);
        }

        seen.add(key);

        if (!keys.has(key)) {
            continue;
        }

        const name = row[NAME_COLUMN];

        if (typeof name !== 'string' || name.trim() === '') {
            throw new TableFormatError(where, `the food ${key} has no name`);
        }

        const readings = new Map(
            columns.map(({ identifier, tag, column }) => [
                tag,
                valueOf(row[column] ?? null, `${where}, food ${key}, ${identifier}`),
            ]),
        );

        lines.push({ key, name, basis: 'per100g', ...lineAmounts(readings) });
    }

    return lines;
}

/** Japan's extractor: role `table` is the chapter 2 workbook. */
export const stfcjExtractor: TableExtractor = {
    roles: ['table'],
    async extract(upstreams, keys) {
        return stfcjLines(await readXlsxSheet(upstreamOf(upstreams, 'table'), SHEET), keys);
    },
};
