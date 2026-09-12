/**
 * Streaming reader for an extracted USDA FoodData Central **bulk download** directory (plan §2 Stage 1).
 *
 * It owns all file I/O and the dataset filter; the mapping to {@link CanonicalCandidate} is the PURE
 * `usdaBulk.parser.ts`. It reads LOCAL FILES ONLY — the bulk datasets are HTTP downloads, not API calls,
 * so the importer never touches the rate-limited USDA API and consumes ZERO of the shared 1,000/hr per-IP
 * quota. Fetching + extracting the zip is an operator step (see `src/foods/seed/README.md`), deliberately
 * kept out of the process so a rerun never re-downloads 500 MB and so the importer is trivially testable.
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
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'csv-parse';

import type { CanonicalCandidate } from '../../foodSourceAdapter.js';
import { SilentWorkerLogger } from '../../../worker/SilentWorkerLogger.js';
import { type WorkerLogger } from '../../../worker/workerLogger.js';
import { UsdaBulkFormatError } from './usdaBulk.errors.js';
import { mapBulkFoodToCanonical } from './usdaBulk.parser.js';
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
} as const;

/** Options for the bulk readers. */
export interface UsdaBulkReadOptions {
    /** Path to the directory holding the extracted bulk CSVs. */
    readonly dir: string;
    /** Optional structured logger (defaults to silent so library use and tests stay quiet). */
    readonly logger?: WorkerLogger;
    /**
     * Which `food.data_type`s to select, defaulting to {@link SEEDED_BULK_DATA_TYPES}.
     *
     * ⚠️ This is a PARAMETER rather than a constant because which datasets the catalog is built from is
     * CONFIGURATION, owned by the catalog roster (`src/foods/seed/catalogDatasets.ts`) — adding Survey
     * (FNDDS) is a roster flip, not an edit to this reader. An explicit selection REPLACES the default;
     * it never widens it.
     */
    readonly dataTypes?: readonly BulkDataType[];
}

/** One raw CSV record, keyed by header name. */
type CsvRecord = Record<string, string>;

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

/**
 * Stream one bulk CSV as header-keyed records. A REQUIRED file that is absent aborts the run; an OPTIONAL
 * file that is absent yields nothing (a dataset with no `food_portion.csv`/`measure_unit.csv` still seeds
 * its foods and nutrients).
 *
 * @param dir - The bulk directory.
 * @param spec - The file's name + required columns.
 * @param required - Whether the file's absence is fatal.
 * @returns An async iterable of header-keyed records.
 * @throws {UsdaBulkFormatError} when a required file is missing, or a header lacks a required column.
 * @sideEffect Opens and streams a file from disk.
 */
async function* readCsv(
    dir: string,
    spec: { readonly name: string; readonly columns: readonly string[] },
    required: boolean,
): AsyncGenerator<CsvRecord> {
    const path = join(dir, spec.name);

    if (!existsSync(path)) {
        if (required) {
            throw new UsdaBulkFormatError(spec.name, `file not found in bulk directory '${dir}'`);
        }

        return;
    }

    const parser = createReadStream(path).pipe(
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
 * @param dir - The bulk directory.
 * @returns The reference lookups.
 * @throws {UsdaBulkFormatError} when `nutrient.csv` is missing or lacks a required column.
 * @sideEffect Reads files from disk.
 */
export async function loadBulkLookups(dir: string): Promise<BulkLookups> {
    const nutrientsById = new Map<string, BulkNutrientDefinition>();

    for await (const record of readCsv(dir, FILES.nutrient, true)) {
        const id = field(record, 'id');

        if (id !== '') {
            nutrientsById.set(id, { name: field(record, 'name'), unitName: field(record, 'unit_name') });
        }
    }

    const measureUnitsById = new Map<string, string>();

    for await (const record of readCsv(dir, FILES.measureUnit, false)) {
        const id = field(record, 'id');

        if (id !== '') {
            measureUnitsById.set(id, field(record, 'name'));
        }
    }

    return { nutrientsById, measureUnitsById };
}

/**
 * Stream the seedable bulk foods, each with its own nutrient + portion rows attached.
 *
 * Three passes over the directory (foods → nutrients → portions), with the FOOD filter applied first so
 * the later passes retain rows only for the selected fdcIds (see the module note on memory). Rows for a
 * food that was filtered out — every Branded row, and the whole Foundation sample-provenance chain — are
 * discarded rather than accumulated.
 *
 * @param options - The bulk directory + optional logger.
 * @returns An async iterable of bulk food bundles.
 * @throws {UsdaBulkFormatError} when a required file is missing or a header lacks a required column.
 * @sideEffect Reads files from disk.
 */
export async function* streamBulkFoodBundles(options: UsdaBulkReadOptions): AsyncGenerator<BulkFoodBundle> {
    const { dir } = options;
    const logger = options.logger ?? new SilentWorkerLogger();
    const selection = selectedDataTypes(options.dataTypes);

    // ── Pass 1: the seedable foods (the filter that bounds everything after it). ──────────────────────
    const selected = new Map<string, { dataType: BulkDataType; description: string; publicationDate: string }>();
    let scannedFoods = 0;

    for await (const record of readCsv(dir, FILES.food, true)) {
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

    for await (const record of readCsv(dir, FILES.foodNutrient, true)) {
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

    for await (const record of readCsv(dir, FILES.foodPortion, false)) {
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

/**
 * Stream an extracted bulk directory as canonical candidates — reader + pure parser composed, and the
 * seam the bulk-seed importer consumes. Foods the parser cannot use (no usable name) are dropped and
 * counted, never emitted as nameless candidates.
 *
 * @param options - The bulk directory + optional logger.
 * @returns An async iterable of canonical candidates (source `usda`, `externalKey` from `fdc_id`).
 * @throws {UsdaBulkFormatError} when a required file is missing or a header lacks a required column.
 * @sideEffect Reads files from disk.
 */
export async function* streamBulkCandidates(options: UsdaBulkReadOptions): AsyncGenerator<CanonicalCandidate> {
    const logger = options.logger ?? new SilentWorkerLogger();
    const lookups = await loadBulkLookups(options.dir);
    let unusable = 0;

    for await (const bundle of streamBulkFoodBundles(options)) {
        const candidate = mapBulkFoodToCanonical(bundle, lookups);

        if (candidate === null) {
            unusable += 1;
            continue;
        }

        yield candidate;
    }

    if (unusable > 0) {
        logger.warn('bulk-foods-unusable', { unusable, reason: 'blank description (no usable name)' });
    }
}
