/**
 * The Branded Foods extract: the cited Branded products' rows, committed as JSON lines (plan U1, KTD-20).
 *
 * @pattern Parser — `parseBrandedExtract` turns the committed bytes into typed products, or refuses them
 * @pattern Canonical serializer — `renderBrandedExtract` is the one authority over the file's bytes
 *
 * The upstream archive is 449 MB and is not committed; the extract of the cited products is, with the
 * archive's name and SHA-256 beside it in `sourcePins.json`. `brandedExtractMain.ts` rebuilds the extract from
 * the archive by hand, and the rebuild proves the extract only if it reproduces the committed bytes exactly.
 *
 * ## ⛔ Why a hand-written renderer: the library-first check (2026-09-30)
 *
 * The committed file was written by CPython: `json.dumps(product, ensure_ascii=False, sort_keys=True)`, one
 * product per line (`.local-sandbox/foodNames/v3/grocery/brandedExtract.py`). Its separators are `", "` and
 * `": "` on ONE line. None of the libraries checked renders that:
 *
 * - `fast-json-stable-stringify`, `json-stable-stringify-without-jsonify` and `fast-stable-stringify` (all
 *   transitive in the tree; each was run) sort keys but emit compact `,` and `:`.
 * - `json-stable-stringify-without-jsonify`'s `space` option (run) adds the spaces only together with newlines
 *   and indentation; `json-stable-stringify` shares that option.
 * - `canonicalize` (RFC 8785) is compact by the standard's definition.
 *
 * So the renderer below is small and pinned by tests instead. Everything that decides a string's bytes is
 * still `JSON.stringify`, whose escaping equals CPython's with `ensure_ascii=False` for every well-formed
 * string: `\"`, `\\`, `\b\f\n\r\t` short forms, other C0 controls as lower-case `\u00xx`, and everything else
 * (non-ASCII, U+2028/U+2029, DEL) written raw. The only difference, a lone surrogate, cannot occur: the bytes
 * are decoded as strict UTF-8, which refuses one.
 */
import type { Buffer } from 'node:buffer';

import { z } from 'zod';

import { readFdcCsv, type CsvEntrySource, type CsvRecord } from '../../../sources/usda/bulk/usdaBulk.reader.js';
import { fdcKey, type FdcKey } from '../catalogKey.js';
import { BrandedExtractFormatError } from './brandedExtract.errors.js';

/** One nutrient row of a Branded product, as FDC published it. */
interface BrandedNutrient {
    /** The amount as written in `food_nutrient.csv`: per 100 g, or per 100 mL for a liquid serving. */
    readonly amount: string;
    /** The nutrient's name, or `''` when `nutrient.csv` does not define its id. */
    readonly name: string;
    /** The FDC nutrient id. */
    readonly nutrientId: number;
    /** The raw unit token (`G`, `MG`, `KCAL`, …), or `''` when undefined. */
    readonly unitName: string;
}

/**
 * One cited Branded product. The snake_case keys are the upstream `branded_food.csv` column names, kept
 * verbatim because the committed bytes carry them.
 */
export interface BrandedProduct {
    readonly available_date: string;
    readonly brand_name: string;
    readonly brand_owner: string;
    readonly branded_food_category: string;
    /** The product's description from `food.csv`. */
    readonly description: string;
    /** The FDC id. */
    readonly fdcId: number;
    readonly gtin_upc: string;
    readonly household_serving_fulltext: string;
    readonly market_country: string;
    readonly modified_date: string;
    /** The product's nutrient rows, sorted by nutrient id. */
    readonly nutrients: readonly BrandedNutrient[];
    /** `food.csv`'s `publication_date`. */
    readonly publicationDate: string;
    readonly serving_size: string;
    /** The serving's unit. A gram unit means the amounts are per 100 g; a volume unit means per 100 mL. */
    readonly serving_size_unit: string;
}

/** The `branded_food.csv` columns the extract carries, in the generator's `FIELDS` order. */
const BRANDED_FIELDS = [
    'brand_owner',
    'brand_name',
    'gtin_upc',
    'serving_size',
    'serving_size_unit',
    'household_serving_fulltext',
    'branded_food_category',
    'available_date',
    'modified_date',
    'market_country',
] as const;

const brandedNutrientSchema = z.strictObject({
    amount: z.string(),
    name: z.string(),
    nutrientId: z.int().positive(),
    unitName: z.string(),
});

const brandedProductSchema = z.strictObject({
    available_date: z.string(),
    brand_name: z.string(),
    brand_owner: z.string(),
    branded_food_category: z.string(),
    description: z.string(),
    fdcId: z.int().positive(),
    gtin_upc: z.string(),
    household_serving_fulltext: z.string(),
    market_country: z.string(),
    modified_date: z.string(),
    nutrients: z.array(brandedNutrientSchema),
    publicationDate: z.string(),
    serving_size: z.string(),
    serving_size_unit: z.string(),
});

/**
 * Compare two strings by Unicode code point, the order CPython's `sort_keys` uses. JavaScript's default sort
 * compares UTF-16 code units instead, which differs for characters above U+FFFF. Pure.
 *
 * @param left - A string.
 * @param right - A string.
 * @returns Negative, zero or positive, as `left` sorts before, with or after `right`.
 */
function compareCodePoints(left: string, right: string): number {
    const a = [...left];
    const b = [...right];

    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const difference = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);

        if (difference !== 0) {
            return difference;
        }
    }

    return a.length - b.length;
}

/**
 * Render a JSON value as CPython's `json.dumps(value, ensure_ascii=False, sort_keys=True)` does. Pure.
 *
 * @param value - A JSON value: strings, safe integers, booleans, null, arrays and plain objects.
 * @returns The one-line rendering.
 * @throws {TypeError} for a value JSON cannot hold, and for a non-integer number, whose CPython `repr` this
 *   renderer does not reproduce.
 */
function renderPythonJson(value: unknown): string {
    if (value === null) {
        return 'null';
    }

    if (typeof value === 'string') {
        return JSON.stringify(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new TypeError(`${String(value)} is not an integer; the extract holds amounts as strings.`);
        }

        return String(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item: unknown) => renderPythonJson(item)).join(', ')}]`;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value).sort(([left], [right]) => compareCodePoints(left, right));

        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${renderPythonJson(item)}`).join(', ')}}`;
    }

    throw new TypeError(`A ${typeof value} has no JSON form.`);
}

/**
 * Render one product as its extract line, nutrients sorted by id (stable, so file order breaks ties). Pure.
 *
 * @param product - The product.
 * @returns The line, without its newline.
 */
function renderProduct(product: BrandedProduct): string {
    const nutrients = [...product.nutrients].sort((left, right) => left.nutrientId - right.nutrientId);

    return renderPythonJson({ ...product, nutrients });
}

/**
 * Render the extract: one line per product, sorted by FDC id, each ending in a newline. Pure.
 *
 * @param products - The products, in any order.
 * @returns The extract's text, byte-identical to the CPython generator's output for the same products.
 */
export function renderBrandedExtract(products: Iterable<BrandedProduct>): string {
    return [...products]
        .sort((left, right) => left.fdcId - right.fdcId)
        .map((product) => `${renderProduct(product)}\n`)
        .join('');
}

/**
 * Parse the committed extract. Every line must be the canonical rendering of its product, in ascending FDC id
 * order, so the parse accepts exactly the bytes {@link renderBrandedExtract} would write. Pure.
 *
 * @param bytes - The extract's bytes.
 * @returns The products, keyed by item key, in file order.
 * @throws {BrandedExtractFormatError} naming the first line that is not canonical, and for bytes that are not
 *   UTF-8 or do not end in a newline.
 */
export function parseBrandedExtract(bytes: Buffer): ReadonlyMap<FdcKey, BrandedProduct> {
    let text: string;

    try {
        // `ignoreBOM` keeps a byte-order mark IN the text, so it fails the canonical check instead of vanishing.
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new BrandedExtractFormatError('the file', 'is not UTF-8');
    }

    const products = new Map<FdcKey, BrandedProduct>();

    if (text === '') {
        return products;
    }

    const lines = text.split('\n');

    if (lines.at(-1) !== '') {
        throw new BrandedExtractFormatError(`line ${String(lines.length)}`, 'does not end in a newline');
    }

    let previousFdcId = 0;

    lines.slice(0, -1).forEach((line, index) => {
        const where = `line ${String(index + 1)}`;
        let value: unknown;

        try {
            value = JSON.parse(line);
        } catch {
            throw new BrandedExtractFormatError(where, 'is not JSON');
        }

        const parsed = brandedProductSchema.safeParse(value);

        if (!parsed.success) {
            throw new BrandedExtractFormatError(
                where,
                parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
            );
        }

        if (renderProduct(parsed.data) !== line) {
            throw new BrandedExtractFormatError(where, 'is not the canonical rendering of its product');
        }

        if (parsed.data.fdcId <= previousFdcId) {
            throw new BrandedExtractFormatError(
                where,
                `fdcId ${String(parsed.data.fdcId)} is out of order or repeated`,
            );
        }

        previousFdcId = parsed.data.fdcId;
        products.set(fdcKey(parsed.data.fdcId), parsed.data);
    });

    return products;
}

/**
 * Read one CSV field that must be present on a cited product's row.
 *
 * @param record - The CSV record.
 * @param column - The column.
 * @param file - The file, for the error.
 * @returns The field, exactly as written.
 * @throws {BrandedExtractFormatError} when the row is too short to hold the column.
 */
function required(record: CsvRecord, column: string, file: string): string {
    const value = record[column];

    if (value === undefined) {
        throw new BrandedExtractFormatError(file, `a cited row has no '${column}' field`);
    }

    return value;
}

/**
 * Parse an FDC integer id field.
 *
 * @param value - The field.
 * @param file - The file, for the error.
 * @returns The id.
 * @throws {BrandedExtractFormatError} when the field is not a positive integer.
 */
function integerId(value: string, file: string): number {
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new BrandedExtractFormatError(file, `'${value}' is not an id`);
    }

    return Number(value);
}

/** A product while its three files are joined: the fields arrive from `branded_food.csv` second. */
interface ProductUnderConstruction {
    readonly fdcId: number;
    readonly description: string;
    readonly publicationDate: string;
    fields?: Record<(typeof BRANDED_FIELDS)[number], string>;
    readonly nutrients: BrandedNutrient[];
}

/**
 * Read the cited products out of a Branded Foods download, as the CPython generator did: `food.csv` for the
 * description and date, `branded_food.csv` for the label fields, `food_nutrient.csv` joined to `nutrient.csv`
 * for the rows. Every field is taken exactly as written.
 *
 * @param source - The download's CSVs (the pinned upstream zip, through the archive adapter).
 * @param cited - The FDC ids the curated seed cites.
 * @returns The cited products the download holds. A cited id it does not hold is simply absent, and the
 *   caller reports it.
 * @throws {BrandedExtractFormatError} when a cited product has no `branded_food.csv` row, or a row is short.
 * @throws {UsdaBulkFormatError} when a file is missing or lacks a required column.
 * @sideEffect Streams four files from the source (about 3 GB uncompressed for the real download).
 */
export async function extractBrandedProducts(
    source: CsvEntrySource,
    cited: ReadonlySet<number>,
): Promise<BrandedProduct[]> {
    const wanted = new Set([...cited].map(String));
    const nutrientNames = new Map<string, { readonly name: string; readonly unitName: string }>();

    for await (const record of readFdcCsv(
        source,
        { name: 'nutrient.csv', columns: ['id', 'name', 'unit_name'] },
        true,
    )) {
        nutrientNames.set(required(record, 'id', 'nutrient.csv'), {
            name: required(record, 'name', 'nutrient.csv'),
            unitName: required(record, 'unit_name', 'nutrient.csv'),
        });
    }

    const products = new Map<string, ProductUnderConstruction>();
    const foodColumns = ['fdc_id', 'description', 'publication_date'];

    for await (const record of readFdcCsv(source, { name: 'food.csv', columns: foodColumns }, true)) {
        const id = required(record, 'fdc_id', 'food.csv');

        if (wanted.has(id)) {
            products.set(id, {
                fdcId: integerId(id, 'food.csv'),
                description: required(record, 'description', 'food.csv'),
                publicationDate: required(record, 'publication_date', 'food.csv'),
                nutrients: [],
            });
        }
    }

    const brandedColumns = ['fdc_id', ...BRANDED_FIELDS];

    for await (const record of readFdcCsv(source, { name: 'branded_food.csv', columns: brandedColumns }, true)) {
        const product = products.get(required(record, 'fdc_id', 'branded_food.csv'));

        if (product !== undefined) {
            product.fields = Object.fromEntries(
                BRANDED_FIELDS.map((column) => [column, required(record, column, 'branded_food.csv')]),
            ) as Record<(typeof BRANDED_FIELDS)[number], string>;
        }
    }

    const nutrientColumns = ['fdc_id', 'nutrient_id', 'amount'];

    for await (const record of readFdcCsv(source, { name: 'food_nutrient.csv', columns: nutrientColumns }, true)) {
        const product = products.get(required(record, 'fdc_id', 'food_nutrient.csv'));

        if (product !== undefined) {
            const nutrientId = required(record, 'nutrient_id', 'food_nutrient.csv');
            const definition = nutrientNames.get(nutrientId);

            product.nutrients.push({
                amount: required(record, 'amount', 'food_nutrient.csv'),
                name: definition?.name ?? '',
                nutrientId: integerId(nutrientId, 'food_nutrient.csv'),
                unitName: definition?.unitName ?? '',
            });
        }
    }

    return [...products.values()].map(({ fields, fdcId, description, publicationDate, nutrients }) => {
        if (fields === undefined) {
            throw new BrandedExtractFormatError('branded_food.csv', `cited product ${String(fdcId)} has no row`);
        }

        return { ...fields, fdcId, description, publicationDate, nutrients };
    });
}
