/**
 * The Canadian Nutrient File 2015's extractor (plan U23, R50, KTD-20): CNF's own foods, read from Health Canada's CSV
 * zip (role `archive`). Values are per 100 g of edible portion, as the CNF 2015 user guide states for the Nutrient
 * Amount file.
 *
 * @pattern Strategy — the `TableExtractor` for the CNF CSV zip
 * @pattern Adapter over csv-parse — a Windows-1252 CSV in the zip becomes header-keyed records
 *
 * CNF names three things twice, and only one of each pair is right here:
 *
 * - A food is keyed by `FoodID`, never `FoodCode` (food 501521 has food code 6324). The structure guide suggests the
 *   code for display; the key is the ID, which every other file joins on.
 * - An amount joins on `NutrientID`, and a nutrient's meaning is its `Tagname`, which IS the INFOODS tag. `NutrientCode`
 *   is neither: STARCH is ID 810 and code 209, and one amount row (food 534) is filed under code 328, which is no ID.
 * - A food's source is its `FoodSourceID`, never `FoodSourceCode`. From 29 up they differ, and the difference matters:
 *   ID 35 is a USDA survey copy, while code 35 is ID 36, a CNF recipe.
 *
 * ## A copy of USDA data is refused
 *
 * Most CNF foods are USDA rows under another name. Citing one would cite USDA's data as Canada's, so a requested food
 * whose source marks a USDA copy is refused, naming it (plan U23). {@link CNF_FOOD_SOURCES} classifies every source the
 * 2015 edition lists, and `FOOD SOURCE.csv` must list exactly those, as described there, or the file is refused: a
 * new or renumbered source must be classified by a person before any food cites it. A food whose source is blank or
 * unlisted (one food uses 32, which `FOOD SOURCE.csv` does not list) is refused too.
 *
 * ## Encoding
 *
 * The CSVs are not UTF-8: `FOOD NAME.csv` writes é as the single byte 0xE9. No CSV in the 2015 zip holds a byte in
 * 0x80-0x9F, the only bytes on which ISO-8859-1 and Windows-1252 differ, so the two read these files identically;
 * the WHATWG decoder maps the label `iso-8859-1` to Windows-1252 anyway. They are decoded as Windows-1252.
 *
 * @module
 */
import { buffer } from 'node:stream/consumers';

import { parse } from 'csv-parse/sync';

import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import type { ExtractLine } from './sourceExtract.js';
import { lineAmounts, readAmount, type AmountMarks, type AmountReading } from './tableCell.js';
import { isTableFormatError, TableFormatError } from './tableExtract.errors.js';
import { upstreamOf, type TableExtractor, type TableUpstreams } from './tableExtractor.js';
import { zipEntrySource, type ZipEntrySource } from './usdaSourceArchive.js';

/** One CSV record, keyed by header name. */
export type CnfRecord = Readonly<Partial<Record<string, string>>>;

/** The four files the mapping reads, as header-keyed records. */
export interface CnfTables {
    /** `FOOD SOURCE.csv`. */
    readonly foodSource: readonly CnfRecord[];
    /** `FOOD NAME.csv`. */
    readonly foodName: readonly CnfRecord[];
    /** `NUTRIENT NAME.csv`. */
    readonly nutrientName: readonly CnfRecord[];
    /** `NUTRIENT AMOUNT.csv`. Rows of foods nobody requested may be left out; the mapping never reads them. */
    readonly nutrientAmount: readonly CnfRecord[];
}

/** A food source CNF lists: its English description, and whether it marks a copy of USDA data. */
export interface CnfFoodSource {
    /** `FoodSourceDescription`, exactly as the 2015 edition writes it. */
    readonly description: string;
    /** Whether a food from this source is USDA's data under another name. */
    readonly usdaCopy: boolean;
}

/**
 * Every food source the 2015 edition lists, by `FoodSourceID`. The USDA copies are the sources whose description
 * begins `FOOD(S) BASED ON DATA FROM USDA`. Source 9 is another country's table; it is not USDA's, so it is admitted.
 */
export const CNF_FOOD_SOURCES: ReadonlyMap<string, CnfFoodSource> = new Map([
    ['0', { usdaCopy: true, description: 'FOODS BASED ON DATA FROM USDA: NO CHANGES' }],
    [
        '1',
        {
            usdaCopy: true,
            description: 'FOOD BASED ON DATA FROM USDA: SOME NUTRIENTS CHANGED TO MEET CANADIAN REGULATIONS',
        },
    ],
    [
        '3',
        {
            usdaCopy: true,
            description: 'FOOD BASED ON DATA FROM USDA: SOME NUTRIENTS ANALYZED IN THE CANADIAN PRODUCT',
        },
    ],
    [
        '4',
        {
            usdaCopy: true,
            description: 'FOOD BASED ON DATA FROM USDA: SOME NUTRIENTS CALCULATED IN THE CANADIAN PRODUCT',
        },
    ],
    [
        '6',
        {
            usdaCopy: true,
            description: 'FOOD BASED ON DATA FROM USDA: SOME VALUES SUPPLIED BY MANUFACTURERS OF THE CANADIAN PRODUCT',
        },
    ],
    ['9', { usdaCopy: false, description: 'DATA SUPPLIED BY AN INTERNATIONAL DATABASE OTHER THAN USDA' }],
    [
        '20',
        {
            usdaCopy: false,
            description:
                'FOOD AVAILABLE IN THE CANADIAN FOOD SUPPLY, BUT NOT FOUND IN THE USDA: NO CHANGES FROM NUTRITION CANADA SURVEY (1970-1972)',
        },
    ],
    [
        '23',
        {
            usdaCopy: false,
            description: 'FOOD AVAILABLE IN THE CANADIAN FOOD SUPPLY, MAJOR NUTRIENTS ANALYZED IN THE CANADIAN PRODUCT',
        },
    ],
    [
        '24',
        { usdaCopy: false, description: 'MAJOR NUTRIENTS CALCULATED IN THE CANADIAN PRODUCT;  NOT A SNAP-CAN FOOD' },
    ],
    [
        '26',
        {
            usdaCopy: false,
            description:
                'FOOD AVAILABLE IN THE CANADIAN FOOD SUPPLY, BUT NOT FOUND IN USDA: NUTRIENT VALUES SUPPLIED BY MANUFACTURERS OF THE CANADIAN PRODUCT',
        },
    ],
    ['28', { usdaCopy: false, description: 'TRADITIONAL FOOD' }],
    [
        '29',
        {
            usdaCopy: true,
            description:
                'FOOD BASED ON DATA FROM USDA: SOME NUTRIENT ANALYZED IN THE CANADIAN PRODUCT.  FOOD HAS BEEN DELETED FROM USDA',
        },
    ],
    ['30', { usdaCopy: true, description: 'FOOD BASED ON DATA FROM USDA.  FOOD HAS BEEN DELETED FROM USDA' }],
    ['35', { usdaCopy: true, description: 'FOOD BASED ON DATA FROM USDA: INFORMATION FROM USDA SURVEY FILES' }],
    ['36', { usdaCopy: false, description: 'CNF RECIPE COMPILATION' }],
    ['38', { usdaCopy: false, description: 'CNF Sampling and Analysis Program (SNAP-CAN)' }],
]);

/** The role of the CNF zip in the table's pins. */
const ARCHIVE_ROLE = 'archive';

/** CNF gives a value only where it has a row, and writes no mark for "no value". */
const MARKS: AmountMarks = { absent: [] };

/** A CNF file, and the columns the mapping reads from it. */
interface CnfCsvSpec {
    readonly name: string;
    readonly columns: readonly string[];
}

const FILES = {
    foodSource: { name: 'FOOD SOURCE.csv', columns: ['FoodSourceID', 'FoodSourceDescription'] },
    foodName: { name: 'FOOD NAME.csv', columns: ['FoodID', 'FoodSourceID', 'FoodDescription'] },
    nutrientName: { name: 'NUTRIENT NAME.csv', columns: ['NutrientID', 'NutrientUnit', 'Tagname'] },
    nutrientAmount: { name: 'NUTRIENT AMOUNT.csv', columns: ['FoodID', 'NutrientID', 'NutrientValue'] },
} as const satisfies Record<string, CnfCsvSpec>;

/** The six tags the extract carries, and the unit `NUTRIENT NAME.csv` must give each. */
const MAPPED_TAGS: readonly { readonly tag: InfoodsTag; readonly unit: string }[] = [
    { tag: INFOODS.energyKcal, unit: 'kCal' },
    { tag: INFOODS.energyKj, unit: 'kJ' },
    { tag: INFOODS.protein, unit: 'g' },
    { tag: INFOODS.fat, unit: 'g' },
    { tag: INFOODS.carbohydrateByDifference, unit: 'g' },
    { tag: INFOODS.fibre, unit: 'g' },
];

/**
 * A record's trimmed field, `''` when absent. Pure.
 *
 * @param record - The record.
 * @param column - The header name.
 * @returns The field.
 */
function textOf(record: CnfRecord, column: string): string {
    return (record[column] ?? '').trim();
}

/**
 * Check `FOOD SOURCE.csv` lists exactly the sources {@link CNF_FOOD_SOURCES} classifies, as described there. Pure.
 *
 * @param rows - `FOOD SOURCE.csv`.
 * @throws {TableFormatError} when a source is unlisted, listed twice, unclassified, or described differently.
 */
function checkFoodSources(rows: readonly CnfRecord[]): void {
    const listed = new Set<string>();

    for (const row of rows) {
        const id = textOf(row, 'FoodSourceID');
        const where = `${FILES.foodSource.name}, FoodSourceID ${id}`;
        const known = CNF_FOOD_SOURCES.get(id);

        if (known === undefined) {
            throw new TableFormatError(where, 'is a source this extractor has not classified as a USDA copy or not');
        }

        if (listed.has(id)) {
            throw new TableFormatError(where, 'is listed twice');
        }

        if (textOf(row, 'FoodSourceDescription') !== known.description) {
            throw new TableFormatError(where, `is no longer described as '${known.description}'`);
        }

        listed.add(id);
    }

    for (const id of CNF_FOOD_SOURCES.keys()) {
        if (!listed.has(id)) {
            throw new TableFormatError(FILES.foodSource.name, `no longer lists FoodSourceID ${id}`);
        }
    }
}

/**
 * Read `NUTRIENT NAME.csv`'s mapped tags. Pure.
 *
 * @param rows - `NUTRIENT NAME.csv`.
 * @returns The tag of each mapped `NutrientID`, and every `NutrientID` the file defines.
 * @throws {TableFormatError} when a mapped tag is absent, listed twice, or given another unit.
 */
function readNutrientNames(rows: readonly CnfRecord[]): {
    readonly tags: ReadonlyMap<string, InfoodsTag>;
    readonly ids: ReadonlySet<string>;
} {
    const ids = new Set(rows.map((row) => textOf(row, 'NutrientID')).filter((id) => id !== ''));
    const tags = new Map<string, InfoodsTag>();

    for (const { tag, unit } of MAPPED_TAGS) {
        const where = `${FILES.nutrientName.name}, Tagname ${tag}`;
        const matches = rows.filter((row) => textOf(row, 'Tagname') === tag);

        if (matches.length !== 1) {
            throw new TableFormatError(
                where,
                `is listed ${String(matches.length)} times; the mapping needs exactly one`,
            );
        }

        const [row] = matches;

        if (textOf(row, 'NutrientUnit') !== unit) {
            throw new TableFormatError(where, `is in '${textOf(row, 'NutrientUnit')}', not '${unit}'`);
        }

        tags.set(textOf(row, 'NutrientID'), tag);
    }

    return { tags, ids };
}

/** A CNF food while its amount rows are read. */
interface FoodUnderConstruction {
    readonly key: string;
    readonly name: string;
    readonly readings: Map<InfoodsTag, AmountReading>;
}

/**
 * Read a requested food's `FOOD NAME.csv` row, refusing a food that is not CNF's own to cite. Pure.
 *
 * @param row - The row.
 * @param key - Its `FoodID`.
 * @returns The food, with no amounts read yet.
 * @throws {TableFormatError} when the food has no name, or its source is blank, unlisted or a USDA copy.
 */
function readFood(row: CnfRecord, key: string): FoodUnderConstruction {
    const where = `${FILES.foodName.name}, FoodID ${key}`;
    const name = row['FoodDescription'] ?? '';

    if (name.trim() === '') {
        throw new TableFormatError(where, 'has no FoodDescription');
    }

    const sourceId = textOf(row, 'FoodSourceID');
    const source = CNF_FOOD_SOURCES.get(sourceId);

    if (source === undefined) {
        throw new TableFormatError(
            where,
            `'${name}' has FoodSourceID '${sourceId}', which ${FILES.foodSource.name} does not list`,
        );
    }

    if (source.usdaCopy) {
        throw new TableFormatError(
            where,
            `'${name}' has FoodSourceID ${sourceId} (${source.description}): it is USDA's data, which CNF is never cited for`,
        );
    }

    return { key, name, readings: new Map() };
}

/**
 * Read the requested CNF foods out of the CNF rows. Pure.
 *
 * Only a requested food's rows are judged. A row of any other food is never read, so a defect there (food 534's amount
 * filed under a code) cannot block an extract that does not cite it.
 *
 * @param tables - `FOOD SOURCE.csv`, `FOOD NAME.csv`, `NUTRIENT NAME.csv` and `NUTRIENT AMOUNT.csv`.
 * @param keys - The candidate keys (`FoodID`s).
 * @returns The line of each requested key the file holds, per 100 g, with each mapped amount under its INFOODS tag,
 *   exactly as written.
 * @throws {TableFormatError} when a reference file is not the one this extractor classifies, or a requested food is a
 *   USDA copy, has a blank or unlisted source, is listed twice, or has an amount row that is short, duplicated, filed
 *   under no `NutrientID`, or no decimal of at most three places.
 */
export function cnfExtractLines(tables: CnfTables, keys: ReadonlySet<string>): ExtractLine[] {
    checkFoodSources(tables.foodSource);

    const { tags, ids } = readNutrientNames(tables.nutrientName);
    const foods = new Map<string, FoodUnderConstruction>();

    for (const row of tables.foodName) {
        const key = textOf(row, 'FoodID');

        if (!keys.has(key)) {
            continue;
        }

        if (foods.has(key)) {
            throw new TableFormatError(`${FILES.foodName.name}, FoodID ${key}`, 'is listed twice');
        }

        foods.set(key, readFood(row, key));
    }

    const seen = new Set<string>();

    for (const row of tables.nutrientAmount) {
        const key = textOf(row, 'FoodID');
        const food = foods.get(key);

        if (food === undefined) {
            continue;
        }

        const nutrientId = textOf(row, 'NutrientID');
        const where = `${FILES.nutrientAmount.name}, FoodID ${key}, NutrientID ${nutrientId}`;

        if (!ids.has(nutrientId)) {
            throw new TableFormatError(where, `'${nutrientId}' is no NutrientID in ${FILES.nutrientName.name}`);
        }

        if (seen.has(`${key}\t${nutrientId}`)) {
            throw new TableFormatError(where, 'gives this nutrient twice');
        }

        seen.add(`${key}\t${nutrientId}`);

        const tag = tags.get(nutrientId);

        if (tag === undefined) {
            continue;
        }

        food.readings.set(tag, readAmount(row['NutrientValue'] ?? null, where, MARKS));
    }

    return [...foods.values()].map(({ key, name, readings }) => ({
        key,
        name,
        basis: 'per100g',
        ...lineAmounts(readings),
    }));
}

/**
 * The header's names, after checking it holds each column the mapping reads exactly once. Pure.
 *
 * @param spec - The file and its columns.
 * @param header - The header's fields.
 * @returns The names, trimmed.
 * @throws {TableFormatError} when a column is absent or named twice.
 */
function checkHeader(spec: CnfCsvSpec, header: readonly string[]): string[] {
    const names = header.map((name) => name.trim());

    for (const column of spec.columns) {
        const count = names.filter((name) => name === column).length;

        if (count !== 1) {
            throw new TableFormatError(spec.name, `names the column ${column} ${String(count)} times, not once`);
        }
    }

    return names;
}

/**
 * Read one CNF file out of the zip as records, keeping only the records a predicate admits.
 *
 * @param source - The zip's entries.
 * @param spec - The file and the columns the mapping reads.
 * @param keep - Which records to keep. `NUTRIENT AMOUNT.csv` holds about half a million rows, so only the requested
 *   foods' rows are kept, the same rows {@link cnfExtractLines} reads.
 * @returns The kept records.
 * @throws {TableFormatError} when the file is absent, is not CSV, has a ragged row, or lacks a column.
 * @sideEffect Reads one entry of the zip.
 */
async function readCnfCsv(
    source: ZipEntrySource,
    spec: CnfCsvSpec,
    keep: (record: CnfRecord) => boolean = () => true,
): Promise<CnfRecord[]> {
    const stream = await source.open(spec.name);

    if (stream === undefined) {
        throw new TableFormatError(spec.name, 'is not in the CNF zip');
    }

    const text = new TextDecoder('windows-1252').decode(await buffer(stream));

    try {
        return parse<Record<string, string>>(text, {
            columns: (header: string[]) => checkHeader(spec, header),
            skip_empty_lines: true,
            on_record: (record) => (keep(record) ? record : null),
        });
    } catch (error) {
        if (isTableFormatError(error)) {
            throw error;
        }

        throw new TableFormatError(spec.name, error instanceof Error ? error.message : 'is not CSV');
    }
}

/** The CNF extractor. */
export const cnfExtractor: TableExtractor = {
    roles: [ARCHIVE_ROLE],

    /**
     * Read the requested CNF foods from the CNF zip.
     *
     * @param upstreams - The CNF zip's bytes, under the role `archive`.
     * @param keys - The candidate keys (`FoodID`s).
     * @returns The requested foods' lines.
     * @throws {TableFormatError} when the zip is not given, a file is not the layout this extractor reads, or a
     *   requested food may not be cited.
     * @throws {ArchiveLayoutError} when the bytes are not a zip.
     * @sideEffect Reads four entries out of the zip held in memory.
     */
    async extract(upstreams: TableUpstreams, keys: ReadonlySet<string>): Promise<readonly ExtractLine[]> {
        const bytes = upstreamOf(upstreams, ARCHIVE_ROLE);

        const source = await zipEntrySource(bytes);

        try {
            return cnfExtractLines(
                {
                    foodSource: await readCnfCsv(source, FILES.foodSource),
                    foodName: await readCnfCsv(source, FILES.foodName),
                    nutrientName: await readCnfCsv(source, FILES.nutrientName),
                    nutrientAmount: await readCnfCsv(source, FILES.nutrientAmount, (record) =>
                        keys.has(textOf(record, 'FoodID')),
                    ),
                },
                keys,
            );
        } finally {
            source.close();
        }
    },
};
