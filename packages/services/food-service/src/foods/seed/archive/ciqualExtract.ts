/**
 * CIQUAL 2025's extractor (plan U23, KTD-20, KTD-24). Anses publishes the table as XML on Recherche Data Gouv
 * (doi:10.57745/RDMHWY): a foods file of `<ALIM>` records and a composition file of `<COMPO>` records, one per food
 * and constituent. Every amount is per 100 g of the edible part (Anses, Ciqual 2020 XML documentation, §1.2.1,
 * zenodo.org/records/4770600; the 2025 documentation PDF prints its text as images, so the 2020 one is cited).
 *
 * @pattern Strategy — the CIQUAL `TableExtractor`
 * @pattern Adapter over fast-xml-parser — a published XML file becomes typed records, or is refused
 *
 * A constituent is found by Anses's own `const_code`, never by its position or its name. The six it maps were checked
 * against `const_2025_11_03.xml`:
 *
 * - 327 and 328: "Energie, Règlement UE N° 1169/2011", in kJ and in kcal. 332 and 333, the energy computed with
 *   Jones' protein factors, are a different definition and are not read.
 * - 25000: "Protéines, N x facteur de Jones". 25003 (N x 6.25) is not read.
 * - 31000: "Glucides". Anses tags it `CHOAVL`, and its documentation says fibre is not included in it ("les fibres
 *   ne sont donc pas incluses dans la ligne relative aux glucides", 2020 XML documentation, §1.2.2). It is the EU
 *   1169/2011 definition, so it includes polyols.
 * - 34100: "Fibres alimentaires", read as total dietary fibre (R53). Anses itself tags it `FIB-`.
 * - 40000: "Lipides".
 *
 * @module
 */
import type { Buffer } from 'node:buffer';

import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { z } from 'zod';

import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import type { ExtractLine } from './sourceExtract.js';
import { keyOf, lineAmounts, readAmount, type AmountMarks, type AmountReading } from './tableCell.js';
import { TableFormatError } from './tableExtract.errors.js';
import { upstreamOf, type TableExtractor } from './tableExtractor.js';

/** One `<ALIM>` record of the foods file: the fields the extractor reads. */
export interface CiqualFood {
    /** The food's code. */
    readonly alim_code: string;
    /** The food's English name. */
    readonly alim_nom_eng: string;
}

/** One `<COMPO>` record of the composition file: the fields the extractor reads. */
export interface CiqualComposition {
    /** The food's code. */
    readonly alim_code: string;
    /** The constituent's code. */
    readonly const_code: string;
    /** The amount, as printed. */
    readonly teneur: string;
}

/** The constituents read, by Anses's code, with the INFOODS tag of each one's definition. */
const CONSTITUENTS: ReadonlyMap<string, InfoodsTag> = new Map([
    ['327', INFOODS.energyKj],
    ['328', INFOODS.energyKcal],
    ['25000', INFOODS.protein],
    ['31000', INFOODS.carbohydrateAvailable],
    ['34100', INFOODS.fibre],
    ['40000', INFOODS.fat],
]);

/**
 * CIQUAL's marks (2020 XML documentation, §1.2.1): `-` is "not known"; `traces` is "detected but not quantified", and
 * an upper bound such as `< 0,5` says the amount is below a limit, so both are traces. The 2025 file always writes one
 * space after `<`; Anses's documentation shows the form `<10`, so both are read.
 */
const MARKS: AmountMarks = { absent: ['-'], trace: ['traces'], tracePattern: /^< ?\d+(,\d+)?$/u, decimalComma: true };

/**
 * A reference left in a decoded value. The parser decodes XML's five named entities but not a character reference
 * (`&#233;`), which would otherwise reach a name as its six raw characters.
 */
const UNDECODED_REFERENCE = /&#?[A-Za-z0-9]+;/u;

/**
 * Map the parsed records to extract lines. Pure.
 *
 * Only a requested food's amounts are read. Some 2025 amounts carry four to six decimal places (`0,0046`), more than
 * an extract holds; reading every food would refuse the whole table for foods nobody cites.
 *
 * @param foods - The foods file's records.
 * @param composition - The composition file's records.
 * @param keys - The requested food codes.
 * @returns The line of every requested food the foods file lists, in the file's order.
 * @throws {TableFormatError} when a code is empty, a food is listed twice, a requested food has no English name, a
 *   requested food has two rows for one constituent or rows the foods file does not list, or an amount is not one of
 *   CIQUAL's forms.
 */
export function ciqualLines(
    foods: readonly CiqualFood[],
    composition: readonly CiqualComposition[],
    keys: ReadonlySet<string>,
): ExtractLine[] {
    const names = new Map<string, string>();

    for (const [index, food] of foods.entries()) {
        const where = `foods, ALIM ${String(index + 1)}`;
        const key = keyOf(food.alim_code, where);

        if (names.has(key)) {
            throw new TableFormatError(where, `lists the food ${key} a second time`);
        }

        names.set(key, food.alim_nom_eng.trim());
    }

    const readings = new Map<string, Map<InfoodsTag, AmountReading>>();

    for (const [index, record] of composition.entries()) {
        const key = keyOf(record.alim_code, `composition, COMPO ${String(index + 1)}`);
        const tag = CONSTITUENTS.get(record.const_code.trim());

        if (!keys.has(key) || tag === undefined) {
            continue;
        }

        const where = `composition, COMPO ${String(index + 1)}, food ${key}, constituent ${record.const_code.trim()}`;

        if (!names.has(key)) {
            throw new TableFormatError(where, 'gives an amount for a food the foods file does not list');
        }

        const food = readings.get(key) ?? new Map<InfoodsTag, AmountReading>();

        if (food.has(tag)) {
            throw new TableFormatError(where, 'is the second row for this food and constituent');
        }

        food.set(tag, readAmount(record.teneur, where, MARKS));
        readings.set(key, food);
    }

    const lines: ExtractLine[] = [];

    for (const [key, name] of names) {
        if (!keys.has(key)) {
            continue;
        }

        if (name === '') {
            throw new TableFormatError(`foods, food ${key}`, 'has no English name');
        }

        lines.push({ key, name, basis: 'per100g', ...lineAmounts(readings.get(key) ?? new Map()) });
    }

    return lines;
}

/** An element's decoded text. A repeated or nested element parses to an array or an object and is refused. */
const textSchema = z.string().refine((text) => !UNDECODED_REFERENCE.test(text), 'holds an undecoded reference');

/** The foods file: `<TABLE>` holding `<ALIM>` records. */
const foodsFileSchema = z.object({
    TABLE: z.object({ ALIM: z.array(z.object({ alim_code: textSchema, alim_nom_eng: textSchema })) }),
});

/** The composition file: `<TABLE>` holding `<COMPO>` records. */
const compositionFileSchema = z.object({
    TABLE: z.object({
        COMPO: z.array(z.object({ alim_code: textSchema, const_code: textSchema, teneur: textSchema })),
    }),
});

/**
 * Parse one published file into its records.
 *
 * Every value stays text: `parseTagValue` is off, so no code or amount passes through a number. Attributes are
 * ignored, so an empty element (`<min missing=" " />`) reads as `''`. The record element is always an array, so a
 * file of one record has the same shape as a file of many. Pure.
 *
 * @param bytes - The file's bytes, already checked against their pin.
 * @param role - The file's role, for the refusal.
 * @param recordTag - The record element, `ALIM` or `COMPO`.
 * @param schema - The file's shape.
 * @returns The parsed file.
 * @throws {TableFormatError} when the bytes are not UTF-8, not well-formed XML, or not the shape.
 */
function parseCiqualFile<T>(bytes: Buffer, role: string, recordTag: string, schema: z.ZodType<T>): T {
    let text: string;

    try {
        // A BOM is stripped here: TextDecoder drops it unless told not to.
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new TableFormatError(role, 'is not UTF-8');
    }

    const parser = new XMLParser({
        ignoreAttributes: true,
        parseTagValue: false,
        trimValues: true,
        isArray: (tagName) => tagName === recordTag,
    });
    let document: unknown;

    try {
        // Validate first: the parser alone reads a truncated file as the records before the cut.
        SyntaxValidator.validate(text);
        document = parser.parse(text);
    } catch (error) {
        throw new TableFormatError(role, `is not well-formed XML: ${error instanceof Error ? error.message : ''}`);
    }

    const parsed = schema.safeParse(document);

    if (!parsed.success) {
        const issue = parsed.error.issues[0];

        throw new TableFormatError(role, `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'is not the shape'}`);
    }

    return parsed.data;
}

/** CIQUAL 2025's extractor: role `foods` is `alim_*.xml`, role `composition` is `compo_*.xml`. */
export const ciqualExtractor: TableExtractor = {
    roles: ['foods', 'composition'],
    extract: (upstreams, keys) =>
        new Promise((resolve) => {
            const foods = parseCiqualFile(upstreamOf(upstreams, 'foods'), 'foods', 'ALIM', foodsFileSchema);
            const composition = parseCiqualFile(
                upstreamOf(upstreams, 'composition'),
                'composition',
                'COMPO',
                compositionFileSchema,
            );

            resolve(ciqualLines(foods.TABLE.ALIM, composition.TABLE.COMPO, keys));
        }),
};
