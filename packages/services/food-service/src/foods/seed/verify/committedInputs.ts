/**
 * Every committed input the catalog verifier reads, and the session temp table each one lands in (curated catalog plan
 * U6, KTD-3, KTD-20).
 *
 * @pattern Registry — one declaration of the inputs, their layouts and their tables; the SQL reads only these tables
 *
 * The verifier's SQL derives the expected catalog from these tables, so this module is the whole of what TypeScript
 * does with the bytes: it finds each file, checks a pinned file against its pin before a byte is copied (the archive
 * reader's guard), and streams the bytes to Postgres unchanged. It interprets nothing. Where a file lives is restated
 * here rather than imported from the seeder (`tableExtractFiles.ts` is outside the fence), and
 * `__tests__/committedInputs.test.ts` holds the two to one answer per dataset.
 *
 * - A USDA archive's CSVs load through Postgres's CSV parser into one text column per field, each held to the header
 *   FDC publishes (`HEADER MATCH`). The seeder's reader treats `food_portion.csv`, `measure_unit.csv` and
 *   `food_category.csv` as optional; so does this, by creating the table empty.
 * - Every other file loads as one row per line, numbered in file order.
 * - A table dataset with no pins file has no extract, and its table is empty, as the seed image has no line for it.
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { z } from 'zod';

import { openPinnedArchive, parseSourcePins, readPinnedBytes } from '../archive/usdaSourceArchive.js';
import { copyCsv, copyLines, createCsvTable, type CopySession } from './copyLoader.js';

/** One USDA bulk CSV, its published header, and whether an archive may lack it. */
interface UsdaCsv {
    /** The entry's basename in the archive. */
    readonly file: string;
    /** The table's name after the archive's prefix. */
    readonly table: string;
    /** The header FDC publishes, which the file must carry exactly. */
    readonly columns: readonly string[];
    /** Whether a missing entry is an error (otherwise the table is created empty). */
    readonly required: boolean;
}

/** The CSVs every pinned archive is read for, with the headers both pinned archives carry (measured 2026-10-01). */
const USDA_CSVS: readonly UsdaCsv[] = [
    {
        file: 'food.csv',
        table: 'food',
        columns: ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'],
        required: true,
    },
    {
        file: 'food_nutrient.csv',
        table: 'food_nutrient',
        columns: [
            'id',
            'fdc_id',
            'nutrient_id',
            'amount',
            'data_points',
            'derivation_id',
            'min',
            'max',
            'median',
            'footnote',
            'min_year_acquired',
        ],
        required: true,
    },
    {
        file: 'nutrient.csv',
        table: 'nutrient',
        columns: ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'],
        required: true,
    },
    {
        file: 'food_portion.csv',
        table: 'food_portion',
        columns: [
            'id',
            'fdc_id',
            'seq_num',
            'amount',
            'measure_unit_id',
            'portion_description',
            'modifier',
            'gram_weight',
            'data_points',
            'footnote',
            'min_year_acquired',
        ],
        required: false,
    },
    { file: 'measure_unit.csv', table: 'measure_unit', columns: ['id', 'name'], required: false },
    { file: 'food_category.csv', table: 'food_category', columns: ['id', 'code', 'description'], required: false },
];

/** The Foundation archive's list of its current items, which only that archive is read for. */
const FOUNDATION_MEMBERS: UsdaCsv = {
    file: 'foundation_food.csv',
    table: 'foundation_food',
    columns: ['fdc_id', 'NDB_number', 'footnote'],
    required: true,
};

/** The two pinned archives: SR Legacy (`v_raw_sr_*`) and Foundation (`v_raw_fd_*`). */
const ARCHIVES = [
    { pin: 'srLegacy', prefix: 'v_raw_sr_', files: USDA_CSVS },
    { pin: 'foundation', prefix: 'v_raw_fd_', files: [...USDA_CSVS, FOUNDATION_MEMBERS] },
] as const;

/**
 * Each table dataset's extract: the directory its pins and extract sit in, and its table. FNDDS's pins are the `fndds`
 * entry of `usda/sourcePins.json`; every other table has `<source>/sourcePins.json`.
 */
export const TABLE_EXTRACTS = [
    { dataset: 'usdaFndds', directory: 'usda', table: 'v_raw_extract_usdafndds' },
    { dataset: 'ciqual', directory: 'ciqual', table: 'v_raw_extract_ciqual' },
    { dataset: 'cofid', directory: 'cofid', table: 'v_raw_extract_cofid' },
    { dataset: 'bls', directory: 'bls', table: 'v_raw_extract_bls' },
    { dataset: 'stfcj', directory: 'stfcj', table: 'v_raw_extract_stfcj' },
    { dataset: 'matvaretabellen', directory: 'matvaretabellen', table: 'v_raw_extract_matvaretabellen' },
    { dataset: 'livsmedelsverket', directory: 'livsmedelsverket', table: 'v_raw_extract_livsmedelsverket' },
    { dataset: 'fsvo', directory: 'fsvo', table: 'v_raw_extract_fsvo' },
    { dataset: 'cnf', directory: 'cnf', table: 'v_raw_extract_cnf' },
] as const;

/** The committed files read whole, line by line, and their tables. */
const LINE_FILES = [
    { path: ['curatedCatalog.jsonl'], table: 'v_raw_catalog' },
    { path: ['catalogChanges.json'], table: 'v_raw_changes' },
    { path: ['sourceCandidates.tsv'], table: 'v_raw_candidates' },
] as const;

/** The Branded extract's table. */
const BRANDED_TABLE = 'v_raw_branded';

/** Every temp table {@link loadCommittedInputs} creates. */
export const RAW_TABLES: readonly string[] = [
    ...ARCHIVES.flatMap((archive) => archive.files.map((file) => `${archive.prefix}${file.table}`)),
    ...TABLE_EXTRACTS.map((extract) => extract.table),
    ...LINE_FILES.map((file) => file.table),
    BRANDED_TABLE,
];

/** A file name with no directory part, the only form a pin may name. */
const BARE_NAME = /^[A-Za-z0-9][A-Za-z0-9._]*$/u;

/** The two fields of a table dataset's pins file the verifier reads: its extract, and the extract's digest. */
const tablePinsSchema = z.looseObject({
    extract: z.string().regex(BARE_NAME, 'must be a bare file name'),
    extractSha256: z.string(),
});

/**
 * Whether a thrown value says the file does not exist. Pure.
 *
 * @param error - The thrown value.
 * @returns `true` for `ENOENT`.
 */
function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The path of a table dataset's pins file. Pure.
 *
 * @param dataDir - The seed data directory.
 * @param directory - The dataset's directory.
 * @returns `<dataDir>/<directory>/sourcePins.json`.
 */
export function extractPinsPathOf(dataDir: string, directory: string): string {
    return join(dataDir, directory, 'sourcePins.json');
}

/**
 * Where a table dataset's extract is and what its bytes must hash to, or `undefined` when it has no pins file.
 *
 * @param dataDir - The seed data directory.
 * @param extract - The dataset's entry in {@link TABLE_EXTRACTS}.
 * @returns The extract's path and pinned SHA-256.
 * @throws {ZodError} when the pins file does not name an extract and its digest.
 * @sideEffect Reads the dataset's pins file.
 */
async function extractPinOf(
    dataDir: string,
    extract: (typeof TABLE_EXTRACTS)[number],
): Promise<{ readonly path: string; readonly sha256: string } | undefined> {
    let text: string;

    try {
        text = await readFile(extractPinsPathOf(dataDir, extract.directory), 'utf8');
    } catch (error) {
        if (isMissing(error)) {
            return undefined;
        }

        throw error;
    }

    const pins =
        extract.dataset === 'usdaFndds' ? parseSourcePins(text).fndds : tablePinsSchema.parse(JSON.parse(text));

    return { path: join(dataDir, extract.directory, pins.extract), sha256: pins.extractSha256 };
}

/**
 * Load one pinned USDA archive's CSVs into `<prefix><table>` temp tables.
 *
 * @param session - The connection.
 * @param archive - The archive's declaration.
 * @param path - The committed archive.
 * @param sha256 - Its pin.
 * @throws {SourcePinMismatchError} before a byte is copied, when the archive differs from its pin.
 * @throws {RangeError} when a required CSV is missing.
 * @sideEffect Reads the archive; creates and fills temp tables.
 */
async function loadArchive(
    session: CopySession,
    archive: (typeof ARCHIVES)[number],
    path: string,
    sha256: string,
): Promise<void> {
    const entries = await openPinnedArchive(path, sha256);

    try {
        for (const csv of archive.files) {
            const table = `${archive.prefix}${csv.table}`;
            const bytes = await entries.open(csv.file);

            if (bytes !== undefined) {
                await copyCsv(session, table, csv.columns, bytes);
            } else if (csv.required) {
                throw new RangeError(`The ${archive.pin} archive holds no ${csv.file}.`);
            } else {
                await createCsvTable(session, table, csv.columns);
            }
        }
    } finally {
        entries.close();
    }
}

/**
 * Load every committed input of the curated seed into its temp table. Every pinned file is checked against its pin
 * before any of its bytes is copied.
 *
 * @param session - The connection, outside any transaction (it creates tables).
 * @param dataDir - The seed data directory.
 * @throws {SourcePinMismatchError} when a pinned file is absent or differs from its pin.
 * @throws {SourcePinsFormatError} when `usda/sourcePins.json` is not the pins shape.
 * @throws {RangeError} when a pinned archive lacks a required CSV.
 * @sideEffect Reads the data directory; creates and fills the session temp tables in {@link RAW_TABLES}.
 */
export async function loadCommittedInputs(session: CopySession, dataDir: string): Promise<void> {
    const usda = join(dataDir, 'usda');
    const pins = parseSourcePins(await readFile(join(usda, 'sourcePins.json'), 'utf8'));

    for (const archive of ARCHIVES) {
        const pin = pins[archive.pin];

        await loadArchive(session, archive, join(usda, pin.file), pin.upstreamSha256);
    }

    for (const extract of TABLE_EXTRACTS) {
        const pin = await extractPinOf(dataDir, extract);
        const chunks = pin === undefined ? [] : [await readPinnedBytes(pin.path, pin.sha256)];

        await copyLines(session, extract.table, Readable.from(chunks));
    }

    const branded = await readPinnedBytes(join(usda, pins.brandedFoods.extract), pins.brandedFoods.extractSha256);

    await copyLines(session, BRANDED_TABLE, Readable.from([branded]));

    for (const file of LINE_FILES) {
        await copyLines(session, file.table, createReadStream(join(dataDir, ...file.path)));
    }
}
