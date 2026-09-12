/**
 * Streaming reader for a USDA FoodData Central **bulk download** (plan §2 Stage 1; curated seed plan U1).
 *
 * @pattern Port — `CsvEntrySource` is the one thing the reader asks of its input: "stream me this CSV".
 * Its adapter is `zipEntrySource` (the committed, checksum-pinned archives, in
 * `foods/seed/archive/usdaSourceArchive.ts`), which satisfies the port STRUCTURALLY, so the dependency points
 * one way: the archive knows no CSV, and this reader knows no zip.
 *
 * It owns the CSV parsing and the dataset filter; the mapping to a `CanonicalCandidate` is the PURE
 * `usdaBulk.parser.ts`. It reads LOCAL BYTES ONLY — the bulk datasets are HTTP downloads, not API calls,
 * so nothing here touches the rate-limited USDA API.
 *
 * ── WHY A REAL CSV PARSER (`csv-parse`), NOT A LINE SPLIT ────────────────────────────────────────────
 * Measured against the published zips: every field is double-quoted (including integers and empty
 * strings), embedded quotes are RFC4180-escaped as `""`, and a quoted field can contain a raw NEWLINE
 * (Foundation `food.csv` has one, making 87,992 physical lines but 87,991 logical rows). A
 * `split('\n')` + `split(',')` loader corrupts that row silently. Columns are resolved by header NAME,
 * never by position, because `food_nutrient.csv` ships 11 columns in the per-dataset zips and 13 in the
 * full download — and the header is VALIDATED up front so a schema drift aborts loudly
 * ({@link UsdaBulkFormatError}) instead of importing nulls.
 *
 * ── MEMORY ──────────────────────────────────────────────────────────────────────────────────────────
 * `food.csv` is streamed and filtered to the seedable `data_type`s FIRST (~8.2k of the Foundation zip's
 * 87,990 rows), then the nutrient/portion files are streamed and kept ONLY for those fdcIds. Peak
 * residency is therefore the SELECTED set (~8.2k foods, ~815k nutrient rows for Foundation + SR Legacy),
 * not the file size — which is what makes pointing this at the 3.4 GB full download tolerable even though
 * Stage 1 does not seed Branded.
 *
 * @implements FR-IDN-2 FR-ADP-2
 */
import type { Readable } from 'node:stream';

import { parse } from 'csv-parse';

import { SilentWorkerLogger } from '../../../worker/SilentWorkerLogger.js';
import { type WorkerLogger } from '../../../worker/workerLogger.js';
import { UsdaBulkFormatError } from './usdaBulk.errors.js';
import {
    SEEDED_BULK_DATA_TYPES,
    type BulkDataType,
    type BulkFoodBundle,
    type BulkLookups,
    type BulkNutrientDefinition,
    type BulkNutrientRow,
    type BulkPortionRow,
} from './usdaBulk.types.js';

/** The bulk CSV filenames, and the columns each one must expose for the mapping to work. */
const FILES = {
    food: { name: 'food.csv', columns: ['fdc_id', 'data_type', 'description', 'publication_date'] },
    foodNutrient: { name: 'food_nutrient.csv', columns: ['fdc_id', 'nutrient_id', 'amount'] },
    nutrient: { name: 'nutrient.csv', columns: ['id', 'name', 'unit_name'] },
    foodPortion: {
        name: 'food_portion.csv',
        columns: ['fdc_id', 'measure_unit_id', 'portion_description', 'modifier', 'gram_weight'],
    },
    measureUnit: { name: 'measure_unit.csv', columns: ['id', 'name'] },
    foundationFood: { name: 'foundation_food.csv', columns: ['fdc_id'] },
} as const;

/** The reader's port: a set of CSV files addressed by name. */
export interface CsvEntrySource {
    /**
     * Stream one CSV file.
     *
     * @param name - The file's name, e.g. `food.csv`.
     * @returns The file's bytes, or `undefined` when the source holds no such file.
     */
    open(name: string): Promise<Readable | undefined>;
}

/** Options for the bulk readers. */
export interface UsdaBulkReadOptions {
    /** The bulk CSVs. */
    readonly source: CsvEntrySource;
    /** Optional structured logger (defaults to silent so library use and tests stay quiet). */
    readonly logger?: WorkerLogger;
    /**
     * Which `food.data_type`s to select, defaulting to {@link SEEDED_BULK_DATA_TYPES}. An explicit selection
     * REPLACES the default; it never widens it.
     */
    readonly dataTypes?: readonly BulkDataType[];
}

/** One raw CSV record, keyed by header name. */
export type CsvRecord = Record<string, string>;

/**
 * Build the `columns` callback `csv-parse` uses to name fields, validating the header up front.
 *
 * @param file - The filename (for error context).
 * @param required - The columns the mapping needs.
 * @returns The `columns` callback.
 * @throws {UsdaBulkFormatError} when a required column is absent from the header.
 */
function headerValidator(file: string, required: readonly string[]): (header: unknown) => string[] {
    return (header: unknown): string[] => {
        const names = (Array.isArray(header) ? (header as unknown[]) : []).map((cell) => String(cell).trim());
        const missing = required.filter((column) => !names.includes(column));

        if (missing.length > 0) {
            throw new UsdaBulkFormatError(file, `missing required column(s): ${missing.join(', ')}`);
        }

        return names;
    };
}

/** A bulk CSV's file name, and the columns a reader of it requires. */
export interface FdcCsvSpec {
    /** The file name, e.g. `food.csv`. */
    readonly name: string;
    /** The header names that must be present; the rest are passed through. */
    readonly columns: readonly string[];
}

/**
 * Stream one FDC CSV as header-keyed records, every field exactly as written (untrimmed). A REQUIRED file
 * that is absent aborts the run; an OPTIONAL file that is absent yields nothing (a dataset with no
 * `food_portion.csv`/`measure_unit.csv` still seeds its foods and nutrients).
 *
 * This is the ONE place the FDC CSV dialect is configured (quoting, BOM, ragged rows), so every reader of a
 * USDA file — this module's bulk passes and the Branded extract — parses it the same way.
 *
 * @param source - The CSV files.
 * @param spec - The file's name + required columns.
 * @param required - Whether the file's absence is fatal.
 * @returns An async iterable of header-keyed records.
 * @throws {UsdaBulkFormatError} when a required file is missing, or a header lacks a required column.
 * @sideEffect Streams a file from the source.
 */
export async function* readFdcCsv(
    source: CsvEntrySource,
    spec: FdcCsvSpec,
    required: boolean,
): AsyncGenerator<CsvRecord> {
    const input = await source.open(spec.name);

    if (input === undefined) {
        if (required) {
            throw new UsdaBulkFormatError(spec.name, 'file not found in the bulk source');
        }

        return;
    }

    const parser = input.pipe(
        parse({
            bom: true,
            columns: headerValidator(spec.name, spec.columns),
            skip_empty_lines: true,
            // FDC pads/omits trailing fields on a handful of rows; tolerate a ragged row rather than
            // aborting an 8k-row import over one, and let the per-value validation drop what it cannot use.
            relax_column_count: true,
        }),
    );

    try {
        for await (const record of parser) {
            yield record as CsvRecord;
        }
    } catch (error) {
        if (error instanceof UsdaBulkFormatError) {
            throw error;
        }

        throw new UsdaBulkFormatError(spec.name, `could not be parsed as CSV (${describe(error)})`);
    }
}

/**
 * Sanitized one-line description of a thrown value (never leaks a stack or a file body).
 *
 * @param error - The thrown value.
 * @returns A short description.
 */
function describe(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}

/** Read a trimmed field, defaulting to the empty string when the column is absent/blank. */
const field = (record: CsvRecord, column: string): string => record[column]?.trim() ?? '';

/**
 * Build the membership test for one run's selected `data_type`s.
 *
 * @param dataTypes - The selection, or `undefined` for {@link SEEDED_BULK_DATA_TYPES}.
 * @returns A predicate narrowing a raw `data_type` field to a selected {@link BulkDataType}.
 */
function selectedDataTypes(dataTypes: readonly BulkDataType[] | undefined): {
    readonly names: readonly BulkDataType[];
    readonly includes: (dataType: string) => dataType is BulkDataType;
} {
    const names = dataTypes ?? SEEDED_BULK_DATA_TYPES;
    const set = new Set<string>(names);

    return { names, includes: (dataType: string): dataType is BulkDataType => set.has(dataType) };
}

/**
 * Load the small reference tables (`nutrient.csv`, `measure_unit.csv`) the per-food rows join against.
 * `nutrient.csv` is REQUIRED (without it no amount has a name or a unit); `measure_unit.csv` is optional.
 *
 * @param source - The bulk CSVs.
 * @returns The reference lookups.
 * @throws {UsdaBulkFormatError} when `nutrient.csv` is missing or lacks a required column.
 * @sideEffect Streams files from the source.
 */
export async function loadBulkLookups(source: CsvEntrySource): Promise<BulkLookups> {
    const nutrientsById = new Map<string, BulkNutrientDefinition>();

    for await (const record of readFdcCsv(source, FILES.nutrient, true)) {
        const id = field(record, 'id');

        if (id !== '') {
            nutrientsById.set(id, { name: field(record, 'name'), unitName: field(record, 'unit_name') });
        }
    }

    const measureUnitsById = new Map<string, string>();

    for await (const record of readFdcCsv(source, FILES.measureUnit, false)) {
        const id = field(record, 'id');

        if (id !== '') {
            measureUnitsById.set(id, field(record, 'name'));
        }
    }

    return { nutrientsById, measureUnitsById };
}

/**
 * Read the CURRENT Foundation items: the ids `foundation_food.csv` lists.
 *
 * The Foundation archive's `food.csv` also keeps superseded rows under the same `foundation_food` data type,
 * so the data type alone does not say which items are current. This file does. It is REQUIRED: the caller asks only of a Foundation archive, and one without
 * the file cannot say which of its rows are current.
 *
 * @param source - A Foundation archive's CSVs.
 * @returns The current items' `fdc_id`s.
 * @throws {UsdaBulkFormatError} when the file is missing or has no `fdc_id` column.
 * @sideEffect Streams one file from the source.
 */
export async function readFoundationMembers(source: CsvEntrySource): Promise<ReadonlySet<string>> {
    const members = new Set<string>();

    for await (const record of readFdcCsv(source, FILES.foundationFood, true)) {
        const fdcId = field(record, 'fdc_id');

        if (fdcId !== '') {
            members.add(fdcId);
        }
    }

    return members;
}

/**
 * Stream the seedable bulk foods, each with its own nutrient + portion rows attached.
 *
 * Three passes over the source (foods → nutrients → portions), with the FOOD filter applied first so
 * the later passes retain rows only for the selected fdcIds (see the module note on memory). Rows for a
 * food that was filtered out — every Branded row, and the whole Foundation sample-provenance chain — are
 * discarded rather than accumulated.
 *
 * @param options - The bulk source + optional logger and data-type selection.
 * @returns An async iterable of bulk food bundles.
 * @throws {UsdaBulkFormatError} when a required file is missing or a header lacks a required column.
 * @sideEffect Streams files from the source.
 */
export async function* streamBulkFoodBundles(options: UsdaBulkReadOptions): AsyncGenerator<BulkFoodBundle> {
    const { source } = options;
    const logger = options.logger ?? new SilentWorkerLogger();
    const selection = selectedDataTypes(options.dataTypes);

    // ── Pass 1: the seedable foods (the filter that bounds everything after it). ──────────────────────
    const selected = new Map<string, { dataType: BulkDataType; description: string; publicationDate: string }>();
    let scannedFoods = 0;

    for await (const record of readFdcCsv(source, FILES.food, true)) {
        scannedFoods += 1;
        const dataType = field(record, 'data_type');
        const fdcId = field(record, 'fdc_id');

        if (fdcId !== '' && selection.includes(dataType)) {
            selected.set(fdcId, {
                dataType,
                // NOT trimmed via `field`: a description may legitimately contain an embedded newline,
                // and the parser trims it for the golden name anyway.
                description: record['description'] ?? '',
                publicationDate: field(record, 'publication_date'),
            });
        }
    }

    logger.info('bulk-foods-selected', { scannedFoods, selected: selected.size, dataTypes: selection.names });

    // ── Pass 2: nutrient rows, kept only for the selected foods. ──────────────────────────────────────
    const nutrientsByFood = new Map<string, BulkNutrientRow[]>();
    let keptNutrients = 0;

    for await (const record of readFdcCsv(source, FILES.foodNutrient, true)) {
        const fdcId = field(record, 'fdc_id');

        if (!selected.has(fdcId)) {
            continue;
        }

        const rows = nutrientsByFood.get(fdcId) ?? [];
        rows.push({ nutrientId: field(record, 'nutrient_id'), amount: field(record, 'amount') });
        nutrientsByFood.set(fdcId, rows);
        keptNutrients += 1;
    }

    // ── Pass 3: portion rows, kept only for the selected foods (optional file). ───────────────────────
    const portionsByFood = new Map<string, BulkPortionRow[]>();
    let keptPortions = 0;

    for await (const record of readFdcCsv(source, FILES.foodPortion, false)) {
        const fdcId = field(record, 'fdc_id');

        if (!selected.has(fdcId)) {
            continue; // Includes the 273 orphan rows with a blank fdc_id.
        }

        const rows = portionsByFood.get(fdcId) ?? [];
        rows.push({
            measureUnitId: field(record, 'measure_unit_id'),
            portionDescription: field(record, 'portion_description'),
            modifier: field(record, 'modifier'),
            gramWeight: field(record, 'gram_weight'),
        });
        portionsByFood.set(fdcId, rows);
        keptPortions += 1;
    }

    logger.info('bulk-rows-loaded', { foods: selected.size, nutrientRows: keptNutrients, portionRows: keptPortions });

    for (const [fdcId, base] of selected) {
        yield {
            fdcId,
            dataType: base.dataType,
            description: base.description,
            publicationDate: base.publicationDate,
            nutrients: nutrientsByFood.get(fdcId) ?? [],
            portions: portionsByFood.get(fdcId) ?? [],
        };
    }
}
