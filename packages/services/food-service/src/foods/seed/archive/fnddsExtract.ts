/**
 * The FNDDS table's extractor (plan U23, R50, KTD-20): USDA's survey foods, read from the FoodData Central survey
 * download that the popularity prior already pins (`usda/sourcePins.json`, role `survey`).
 *
 * @pattern Strategy — the `TableExtractor` for the FNDDS survey download
 * @pattern Adapter over `readFdcCsv` — the zip's CSVs become header-keyed records, in the one FDC CSV dialect
 *
 * A key is `fdc:<fdc_id>`. Only `food.csv` rows of data type `survey_fndds_food` are FNDDS foods; a requested USDA key
 * that names an SR Legacy, Foundation or Branded item is left out, because other inputs serve those.
 *
 * ## ⚠️ `food_nutrient.csv`'s `nutrient_id` holds nutrient NUMBERS, not nutrient ids (measured on the 2024-10-31 file)
 *
 * Its 65 distinct values (203, 204, 205, 208, 291, …) are `nutrient.csv`'s `nutrient_nbr`, and none of them is an
 * `id` there. So the mapping is by number, and each mapped number's name and unit are checked against `nutrient.csv`
 * before a value is read. A requested food's row whose `nutrient_id` is no `nutrient_nbr` is refused: that is how a
 * future switch to real ids shows (Energy is id 1008). In this file no `id` equals any `nutrient_nbr`, so the switch
 * cannot pass that check unseen.
 *
 * `usdaBulk.reader.ts` maps nutrients by `id`, so pointed at this download it reads no FNDDS nutrient at all.
 *
 * @module
 */
import { isUsdaBulkFormatError } from '../../../sources/usda/bulk/usdaBulk.errors.js';
import {
    readFdcCsv,
    type CsvEntrySource,
    type CsvRecord,
    type FdcCsvSpec,
} from '../../../sources/usda/bulk/usdaBulk.reader.js';
import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import { fdcIdOf, isFdcKey, type FdcKey } from '../catalogKey.js';
import type { ExtractLine } from './sourceExtract.js';
import { lineAmounts, readAmount, type AmountMarks, type AmountReading } from './tableCell.js';
import { TableFormatError } from './tableExtract.errors.js';
import { upstreamOf, type TableExtractor, type TableUpstreams } from './tableExtractor.js';
import { zipEntrySource } from './usdaSourceArchive.js';

/** One CSV record, keyed by header name. A ragged row lacks its last fields, so any field may be absent. */
export type FnddsRecord = Readonly<Partial<Record<string, string>>>;

/** The three files the mapping reads, as header-keyed records. */
export interface FnddsTables {
    /** `nutrient.csv`. */
    readonly nutrient: readonly FnddsRecord[];
    /** `food.csv`. */
    readonly food: readonly FnddsRecord[];
    /** `food_nutrient.csv`. Rows of foods nobody requested may be left out; the mapping never reads them. */
    readonly foodNutrient: readonly FnddsRecord[];
}

/** The role of the survey download in the table's pins. */
const SURVEY_ROLE = 'survey';

/** The `food.csv` data type of an FNDDS food. */
const FNDDS_DATA_TYPE = 'survey_fndds_food';

/** FNDDS writes every value it gives, and gives none it lacks a row for: it has no mark for "no value". */
const MARKS: AmountMarks = { absent: [] };

const FILES = {
    nutrient: { name: 'nutrient.csv', columns: ['name', 'unit_name', 'nutrient_nbr'] },
    food: { name: 'food.csv', columns: ['fdc_id', 'data_type', 'description'] },
    foodNutrient: { name: 'food_nutrient.csv', columns: ['fdc_id', 'nutrient_id', 'amount'] },
} as const satisfies Record<string, FdcCsvSpec>;

/** A nutrient number the mapping reads, and the definition `nutrient.csv` must give it. */
interface MappedNumber {
    readonly number: string;
    readonly name: string;
    readonly unit: string;
    readonly tag: InfoodsTag;
}

/** The six numbers the extract carries, with each one's name and unit in the 2024-10-31 `nutrient.csv`. */
const MAPPED_NUMBERS: readonly MappedNumber[] = [
    { number: '208', name: 'Energy', unit: 'KCAL', tag: INFOODS.energyKcal },
    { number: '268', name: 'Energy', unit: 'kJ', tag: INFOODS.energyKj },
    { number: '203', name: 'Protein', unit: 'G', tag: INFOODS.protein },
    { number: '204', name: 'Total lipid (fat)', unit: 'G', tag: INFOODS.fat },
    { number: '205', name: 'Carbohydrate, by difference', unit: 'G', tag: INFOODS.carbohydrateByDifference },
    { number: '291', name: 'Fiber, total dietary', unit: 'G', tag: INFOODS.fibre },
];

/**
 * The FDC ids of the requested keys. Pure.
 *
 * @param keys - The candidate keys.
 * @returns Each requested FDC id's digits, with its key. A key that is not an `fdc:<id>` names no FNDDS food.
 */
function requestedFdcIds(keys: ReadonlySet<string>): ReadonlyMap<string, FdcKey> {
    const ids = new Map<string, FdcKey>();

    for (const key of keys) {
        if (isFdcKey(key)) {
            ids.set(String(fdcIdOf(key)), key);
        }
    }

    return ids;
}

/**
 * A record's field, which a requested row must have. Pure.
 *
 * @param record - The record.
 * @param column - The header name.
 * @param where - The file and row, for the refusal.
 * @returns The field as written.
 * @throws {TableFormatError} when the row is too short to hold the field.
 */
function fieldOf(record: FnddsRecord, column: string, where: string): string {
    const value = record[column];

    if (value === undefined) {
        throw new TableFormatError(where, `has no ${column}`);
    }

    return value;
}

/**
 * Check `nutrient.csv` gives each mapped number the definition the mapping assumes. Pure.
 *
 * @param nutrients - `nutrient.csv`.
 * @returns The tag of each mapped number, and every nutrient number the file defines.
 * @throws {TableFormatError} when a mapped number is absent, listed twice, or named or measured differently.
 */
function readDefinitions(nutrients: readonly FnddsRecord[]): {
    readonly tags: ReadonlyMap<string, InfoodsTag>;
    readonly numbers: ReadonlySet<string>;
} {
    const numbers = new Set<string>();

    for (const record of nutrients) {
        const number = (record['nutrient_nbr'] ?? '').trim();

        if (number !== '') {
            numbers.add(number);
        }
    }

    const tags = new Map<string, InfoodsTag>();

    for (const mapped of MAPPED_NUMBERS) {
        const where = `${FILES.nutrient.name}, nutrient_nbr ${mapped.number}`;
        const rows = nutrients.filter((record) => (record['nutrient_nbr'] ?? '').trim() === mapped.number);

        if (rows.length !== 1) {
            throw new TableFormatError(where, `is listed ${String(rows.length)} times; the mapping needs exactly one`);
        }

        const [row] = rows;

        if (row['name'] !== mapped.name || row['unit_name'] !== mapped.unit) {
            throw new TableFormatError(
                where,
                `is '${row['name'] ?? ''}' in ${row['unit_name'] ?? ''}, not '${mapped.name}' in ${mapped.unit}`,
            );
        }

        tags.set(mapped.number, mapped.tag);
    }

    return { tags, numbers };
}

/** An FNDDS food while its nutrient rows are read. */
interface FoodUnderConstruction {
    readonly key: FdcKey;
    readonly name: string;
    readonly readings: Map<InfoodsTag, AmountReading>;
}

/**
 * Read the requested FNDDS foods out of the survey download's rows. Pure.
 *
 * Only a requested food's rows are judged. A row of any other food is never read, so a defect there cannot block an
 * extract that does not cite it.
 *
 * @param tables - `nutrient.csv`, `food.csv` and `food_nutrient.csv`.
 * @param keys - The candidate keys (`fdc:<id>`).
 * @returns The line of each requested key that is an FNDDS food, per 100 g, with each mapped number's amount under
 *   its INFOODS tag, exactly as written.
 * @throws {TableFormatError} when `nutrient.csv` does not define a mapped number as assumed, or a requested food's row
 *   is short, duplicated, names no nutrient number, or holds an amount that is no decimal of at most three places.
 */
export function fnddsExtractLines(tables: FnddsTables, keys: ReadonlySet<string>): ExtractLine[] {
    const { tags, numbers } = readDefinitions(tables.nutrient);
    const requested = requestedFdcIds(keys);
    const foods = new Map<string, FoodUnderConstruction>();

    for (const record of tables.food) {
        const id = (record['fdc_id'] ?? '').trim();
        const key = requested.get(id);

        if (key === undefined) {
            continue;
        }

        const where = `${FILES.food.name}, fdc_id ${id}`;

        if (fieldOf(record, 'data_type', where) !== FNDDS_DATA_TYPE) {
            continue;
        }

        if (foods.has(id)) {
            throw new TableFormatError(where, 'lists this FNDDS food twice');
        }

        const name = fieldOf(record, 'description', where);

        if (name.trim() === '') {
            throw new TableFormatError(where, 'has no description');
        }

        foods.set(id, { key, name, readings: new Map() });
    }

    const seen = new Set<string>();

    for (const record of tables.foodNutrient) {
        const id = (record['fdc_id'] ?? '').trim();
        const food = foods.get(id);

        if (food === undefined) {
            continue;
        }

        const number = fieldOf(record, 'nutrient_id', `${FILES.foodNutrient.name}, fdc_id ${id}`).trim();
        const where = `${FILES.foodNutrient.name}, fdc_id ${id}, nutrient_id ${number}`;

        if (!numbers.has(number)) {
            throw new TableFormatError(
                where,
                `'${number}' is no nutrient_nbr in ${FILES.nutrient.name}; this download is read by nutrient number`,
            );
        }

        if (seen.has(`${id}\t${number}`)) {
            throw new TableFormatError(where, 'gives this nutrient twice');
        }

        seen.add(`${id}\t${number}`);

        const tag = tags.get(number);

        if (tag === undefined) {
            continue;
        }

        food.readings.set(tag, readAmount(fieldOf(record, 'amount', where), where, MARKS));
    }

    return [...foods.values()].map(({ key, name, readings }) => ({
        key,
        name,
        basis: 'per100g',
        ...lineAmounts(readings),
    }));
}

/**
 * Stream one required file of the download, refusing a missing file or column as a table format error.
 *
 * @param source - The download's CSVs.
 * @param spec - The file and the columns the mapping reads.
 * @returns The file's records.
 * @throws {TableFormatError} when the file is absent, unparseable, or lacks a column.
 * @sideEffect Streams one file from the source.
 */
async function* recordsOf(source: CsvEntrySource, spec: FdcCsvSpec): AsyncGenerator<CsvRecord> {
    try {
        yield* readFdcCsv(source, spec, true);
    } catch (error) {
        if (isUsdaBulkFormatError(error)) {
            throw new TableFormatError(error.file, error.message);
        }

        throw error;
    }
}

/**
 * Read one file of the download into memory, keeping only the records a predicate admits.
 *
 * @param source - The download's CSVs.
 * @param spec - The file and the columns the mapping reads.
 * @param keep - Which records to keep.
 * @returns The kept records.
 * @throws {TableFormatError} when the file is absent, unparseable, or lacks a column.
 * @sideEffect Streams one file from the source.
 */
async function collect(
    source: CsvEntrySource,
    spec: FdcCsvSpec,
    keep: (record: FnddsRecord) => boolean = () => true,
): Promise<CsvRecord[]> {
    const records: CsvRecord[] = [];

    for await (const record of recordsOf(source, spec)) {
        if (keep(record)) {
            records.push(record);
        }
    }

    return records;
}

/** The FNDDS extractor. */
export const fnddsExtractor: TableExtractor = {
    roles: [SURVEY_ROLE],

    /**
     * Read the requested FNDDS foods from the survey download. `food_nutrient.csv` is about 19 MB, so only the rows of
     * requested foods are held, the same rows {@link fnddsExtractLines} reads.
     *
     * @param upstreams - The survey download's bytes, under the role `survey`.
     * @param keys - The candidate keys.
     * @returns The requested FNDDS foods' lines.
     * @throws {TableFormatError} when the download is not given, or a file is not the layout this extractor reads.
     * @throws {ArchiveLayoutError} when the bytes are not a zip.
     * @sideEffect Streams three files out of the zip held in memory.
     */
    async extract(upstreams: TableUpstreams, keys: ReadonlySet<string>): Promise<readonly ExtractLine[]> {
        const bytes = upstreamOf(upstreams, SURVEY_ROLE);

        const requested = requestedFdcIds(keys);
        const source = await zipEntrySource(bytes);

        try {
            const nutrient = await collect(source, FILES.nutrient);
            const food = await collect(source, FILES.food);
            const foodNutrient = await collect(source, FILES.foodNutrient, (record) =>
                requested.has((record['fdc_id'] ?? '').trim()),
            );

            return fnddsExtractLines({ nutrient, food, foodNutrient }, keys);
        } finally {
            source.close();
        }
    },
};
