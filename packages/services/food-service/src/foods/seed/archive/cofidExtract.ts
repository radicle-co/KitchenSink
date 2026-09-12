/**
 * CoFID 2021, McCance and Widdowson's Composition of Foods Integrated Dataset, as extract lines (plan U23, KTD-20,
 * R53, R54). The workbook names each component column by CoFID's own code in row 2, so a column is found by its code
 * and refused when the code is missing or printed twice. Quotations below are from the CoFID 2021 user guide.
 *
 * @pattern Strategy — the `cofid` table extractor
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

/** A data row with its key, and where it is for a refusal. */
interface KeyedRow {
    readonly key: string;
    readonly row: readonly TableCell[];
    readonly where: string;
}

/** A mapped component and the column CoFID prints it in. */
interface ComponentColumn {
    readonly tag: InfoodsTag;
    readonly code: string;
    readonly index: number;
}

/** The two sheets the extractor reads. */
export interface CofidSheets {
    /** `1.3 Proximates`: the energy and macronutrient values. */
    readonly proximates: TableRows;
    /** `1.2 Factors`: the specific gravity of each food. */
    readonly factors: TableRows;
}

const PROXIMATES = '1.3 Proximates';
const FACTORS = '1.2 Factors';

/** The guide: "Each sheet contains column headings in rows 1 to 3 of the spreadsheet, then data values". */
const FIRST_DATA_ROW = 3;

/** Row 1 holds the header names; row 2 holds CoFID's component codes. */
const HEADER_ROW = 0;
const CODE_ROW = 1;

/** The columns CoFID prints at a fixed place in both sheets. */
const FOOD_CODE = { index: 0, header: 'Food Code' } as const;
const FOOD_NAME = { index: 1, header: 'Food Name' } as const;
const GROUP = { index: 3, header: 'Group' } as const;
const SPECIFIC_GRAVITY = { index: 8, header: 'Specific gravity' } as const;

/**
 * Each mapped component: CoFID's code, the row-1 header that states its unit (the code row does not), and the INFOODS
 * tag of its definition (R53).
 */
const COMPONENTS: readonly { readonly code: string; readonly header: string; readonly tag: InfoodsTag }[] = [
    { code: 'PROT', header: 'Protein (g)', tag: INFOODS.protein },
    { code: 'FAT', header: 'Fat (g)', tag: INFOODS.fat },
    // Guide, "Carbohydrate (CHO)": components "but not fibre, are wherever possible expressed as their monosaccharide
    // equivalent", obtained "from the sum of analysed values for these components of 'available carbohydrate'".
    { code: 'CHO', header: 'Carbohydrate (g)', tag: INFOODS.carbohydrateAvailableMonosaccharides },
    { code: 'KCALS', header: 'Energy (kcal) (kcal)', tag: INFOODS.energyKcal },
    { code: 'KJ', header: 'Energy (kJ) (kJ)', tag: INFOODS.energyKj },
    // Guide, "AOAC fibre (AOACFIB)": AOAC determinations "include resistant starch and lignin in the estimation of total
    // fibre". NSP (ENGFIB) counts only the non-starch polysaccharides, a narrower definition, so it is never read.
    { code: 'AOACFIB', header: 'AOAC fibre (g)', tag: INFOODS.fibre },
];

/**
 * The groups published per 100 mL. Guide: "Nutrient values are expressed per 100g of the food except in the case of
 * alcoholic beverages which are presented per 100ml", and its group list names the alcoholic groups exactly. A list,
 * not a prefix: any other group starting with Q is refused, because its basis is unknown (R54).
 */
const PER_100_ML_GROUPS: readonly string[] = ['Q', 'QA', 'QC', 'QE', 'QF', 'QG', 'QI', 'QK'];

/**
 * Guide: a trace "is represented by Tr"; a nutrient present with no reliable amount "is represented by N", which is not
 * known, as is an empty cell.
 */
const VALUE_MARKS: AmountMarks = { absent: ['N', ''], trace: ['Tr'] };

/** CoFID gives most foods no specific gravity, by an empty cell and no other mark. */
const GRAVITY_MARKS: AmountMarks = { absent: [''] };

/**
 * A text cell, trimmed. Pure.
 *
 * @param cell - The cell.
 * @param where - Where it is, for the refusal.
 * @param what - What it should hold, for the refusal.
 * @returns Its text.
 * @throws {TableFormatError} when the cell is empty or a number.
 */
function textOf(cell: TableCell, where: string, what: string): string {
    const text = typeof cell === 'string' ? cell.trim() : '';

    if (text === '') {
        throw new TableFormatError(where, `has no ${what}`);
    }

    return text;
}

/**
 * Assert the exact header at a fixed column. Pure.
 *
 * @param rows - The sheet.
 * @param sheet - Its name.
 * @param column - The column and the header it must hold.
 * @throws {TableFormatError} when the header differs, so a re-laid-out edition is refused.
 */
function assertHeader(
    rows: TableRows,
    sheet: string,
    column: { readonly index: number; readonly header: string },
): void {
    const header = cellAt(rows[HEADER_ROW] ?? [], column.index);

    if (header !== column.header) {
        throw new TableFormatError(
            `${sheet}, row 1, column ${String(column.index + 1)}`,
            `holds ${JSON.stringify(header)}, not '${column.header}'`,
        );
    }
}

/**
 * The column of each mapped component, found by its code. Pure.
 *
 * @param rows - The Proximates sheet.
 * @returns Each component with its column.
 * @throws {TableFormatError} when a code is missing or printed twice, or its header states another name or unit.
 */
function componentColumns(rows: TableRows): readonly ComponentColumn[] {
    const codes = rows[CODE_ROW] ?? [];

    return COMPONENTS.map((component) => {
        const indexes = codes.flatMap((cell, index) => (cell === component.code ? [index] : []));
        const [index] = indexes;

        if (index === undefined || indexes.length > 1) {
            throw new TableFormatError(
                `${PROXIMATES}, row 2`,
                `prints the code ${component.code} ${String(indexes.length)} times, not once`,
            );
        }

        assertHeader(rows, PROXIMATES, { index, header: component.header });

        return { tag: component.tag, code: component.code, index };
    });
}

/**
 * The data rows of a sheet with their keys. Every key is read, so a key stored as a number is refused wherever it is.
 * Pure.
 *
 * @param rows - The sheet.
 * @param sheet - Its name.
 * @returns Each data row with its key and where it is.
 * @throws {TableFormatError} when a row has no key or a numeric one.
 */
function keyedRows(rows: TableRows, sheet: string): readonly KeyedRow[] {
    return rows.slice(FIRST_DATA_ROW).map((row, offset) => {
        const where = `${sheet}, row ${String(FIRST_DATA_ROW + offset + 1)}`;

        return { key: keyOf(cellAt(row, FOOD_CODE.index), where), row, where };
    });
}

/**
 * The specific gravity CoFID gives a food, read as grams per millilitre. The guide defines it as the food's density
 * relative to water's; water is 1 g/mL to the two places CoFID prints, so the number is copied, not converted. Pure.
 *
 * @param factors - The Factors sheet's keyed rows.
 * @param key - The food's code.
 * @param name - The food's name in Proximates.
 * @returns The specific gravity.
 * @throws {TableFormatError} when the food has no Factors row, two of them, another name there, or no specific
 *   gravity: a per-100 mL value converts only with a density from the same source (R54), so none is guessed.
 */
function specificGravityOf(factors: readonly KeyedRow[], key: string, name: string): string {
    const matches = factors.filter((entry) => entry.key === key);
    const [match] = matches;

    if (match === undefined || matches.length > 1) {
        throw new TableFormatError(
            `${FACTORS}, ${key}`,
            `has ${String(matches.length)} rows, so the specific gravity of a per-100 mL food is not one value`,
        );
    }

    const factorName = textOf(cellAt(match.row, FOOD_NAME.index), match.where, 'food name');

    if (factorName !== name) {
        throw new TableFormatError(match.where, `names '${factorName}', not '${name}'`);
    }

    const gravity = readAmount(
        cellAt(match.row, SPECIFIC_GRAVITY.index),
        `${match.where}, ${SPECIFIC_GRAVITY.header}`,
        GRAVITY_MARKS,
    );

    if (gravity.kind !== 'value') {
        throw new TableFormatError(match.where, `${key} is published per 100 mL and has no specific gravity`);
    }

    return gravity.value;
}

/**
 * Whether a food's values are published per 100 mL. Pure.
 *
 * @param group - The food's CoFID group code.
 * @param where - Its row, for the refusal.
 * @returns True for an alcoholic beverage.
 * @throws {TableFormatError} for a group starting with Q that the guide's list does not hold.
 */
function isPer100Ml(group: string, where: string): boolean {
    if (PER_100_ML_GROUPS.includes(group)) {
        return true;
    }

    if (group.startsWith('Q')) {
        throw new TableFormatError(where, `the group ${group} is not one the guide lists, so its basis is unknown`);
    }

    return false;
}

/**
 * The extract lines of the requested foods. Pure.
 *
 * @param sheets - The Proximates and Factors sheets.
 * @param keys - The requested food codes.
 * @returns One line per requested code the table holds. A code it does not hold is left out.
 * @throws {TableFormatError} when a sheet is laid out otherwise, a key is numeric, a requested key is held twice, or a
 *   requested food holds a cell, a group or a missing specific gravity this extractor does not read.
 */
export function cofidLines(sheets: CofidSheets, keys: ReadonlySet<string>): ExtractLine[] {
    const { proximates, factors } = sheets;

    for (const column of [FOOD_CODE, FOOD_NAME, GROUP]) {
        assertHeader(proximates, PROXIMATES, column);
    }

    for (const column of [FOOD_CODE, FOOD_NAME, SPECIFIC_GRAVITY]) {
        assertHeader(factors, FACTORS, column);
    }

    const columns = componentColumns(proximates);
    const factorRows = keyedRows(factors, FACTORS);
    const lines = new Map<string, ExtractLine>();

    for (const { key, row, where } of keyedRows(proximates, PROXIMATES)) {
        if (!keys.has(key)) {
            continue;
        }

        if (lines.has(key)) {
            // CoFID 2021 prints 13-669 for both a roasted aubergine and raw watercress.
            throw new TableFormatError(where, `${key} is held twice, so it names no one food`);
        }

        const name = textOf(cellAt(row, FOOD_NAME.index), where, 'food name');
        const amounts = lineAmounts(
            new Map(
                columns.map((column) => [
                    column.tag,
                    readAmount(cellAt(row, column.index), `${where}, ${column.code}`, VALUE_MARKS),
                ]),
            ),
        );

        const line: ExtractLine = isPer100Ml(textOf(cellAt(row, GROUP.index), where, 'group'), where)
            ? { key, name, basis: 'per100mL', ...amounts, densityGramsPerMl: specificGravityOf(factorRows, key, name) }
            : { key, name, basis: 'per100g', ...amounts };

        lines.set(key, line);
    }

    return [...lines.values()];
}

/** The CoFID 2021 extractor: one workbook, under the role `table`. */
export const cofidExtractor: TableExtractor = {
    roles: ['table'],
    async extract(upstreams, keys) {
        const bytes = upstreamOf(upstreams, 'table');

        return cofidLines(
            { proximates: await readXlsxSheet(bytes, PROXIMATES), factors: await readXlsxSheet(bytes, FACTORS) },
            keys,
        );
    },
};
