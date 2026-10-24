/**
 * The seed's one I/O door: read and verify every committed input, and hand the pure pipeline parsed values
 * (plan U1). U3, U5 and U6 reuse it; the independent verifier (KTD-3) never imports it.
 *
 * @pattern Facade — one call over the pins, the two pinned archives, the bulk reader, every pinned table extract and
 *   the parsers
 *
 * Every pinned file is checked against its SHA-256 before a byte of it is parsed (`usdaSourceArchive.ts`), so
 * a tampered archive or extract is refused before any row is read.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { UsdaBulkFormatError } from '../../../sources/usda/bulk/usdaBulk.errors.js';
import {
    loadBulkLookups,
    readFoundationMembers,
    streamBulkFoodBundles,
} from '../../../sources/usda/bulk/usdaBulk.reader.js';
import type { BulkDataType } from '../../../sources/usda/bulk/usdaBulk.types.js';
import { parseBrandedExtract } from '../archive/brandedExtract.js';
import { parseSourceExtract, type ExtractLine } from '../archive/sourceExtract.js';
import { tableExtractPathOf, tablePinsOf } from '../archive/tableExtractFiles.js';
import { openPinnedArchive, parseSourcePins, readPinnedBytes } from '../archive/usdaSourceArchive.js';
import { TABLE_DATASETS, type TableDataset } from '../citationDatasets.js';
import { usdaItemFactsOf, type UsdaItemFacts } from './baselineSeed.js';
import { parseCuratedSeed } from './curatedSeedFormat.js';
import type { SeedInputs } from './seedImage.js';
import { parseSourceCandidates, SOURCE_CANDIDATES_FILE } from './sourceCandidates.js';

/**
 * Read one pinned USDA archive's items.
 *
 * @param path - The committed archive.
 * @param sha256 - Its pin.
 * @param dataType - The data type its items carry.
 * @returns The items' facts. For a Foundation archive, only the current items `foundation_food.csv` lists.
 * @throws {SourcePinMismatchError} before any row is read, when the archive's bytes differ from the pin.
 * @throws {UsdaBulkFormatError} when a file is missing, or `foundation_food.csv` lists an item with no row.
 * @sideEffect Reads the archive.
 */
async function readArchiveItems(path: string, sha256: string, dataType: BulkDataType): Promise<UsdaItemFacts[]> {
    const source = await openPinnedArchive(path, sha256);

    try {
        const lookups = await loadBulkLookups(source);
        const members = dataType === 'foundation_food' ? await readFoundationMembers(source) : undefined;
        const items: UsdaItemFacts[] = [];

        for await (const bundle of streamBulkFoodBundles({ source, dataTypes: [dataType] })) {
            if (members === undefined) {
                items.push(usdaItemFactsOf(bundle, lookups, null));
            } else if (members.has(bundle.fdcId)) {
                items.push(usdaItemFactsOf(bundle, lookups, { ndbNumber: members.get(bundle.fdcId) ?? null }));
            }
        }

        if (members !== undefined && items.length !== members.size) {
            throw new UsdaBulkFormatError(
                'foundation_food.csv',
                `${String(members.size - items.length)} listed item(s) have no foundation_food row in food.csv`,
            );
        }

        return items;
    } finally {
        source.close();
    }
}

/**
 * Read every pinned table extract.
 *
 * @param dataDir - The seed data directory.
 * @returns Each table dataset's extract lines by key.
 * @throws {SourcePinMismatchError} before a line is read, when an extract differs from its pin.
 * @throws {SourcePinsFormatError} when a pins file is not the shape.
 * @throws {SourceExtractFormatError} when an extract is not canonical.
 * @sideEffect Reads the pins and extracts.
 */
async function readTableExtracts(
    dataDir: string,
): Promise<ReadonlyMap<TableDataset, ReadonlyMap<string, ExtractLine>>> {
    const extracts = new Map<TableDataset, ReadonlyMap<string, ExtractLine>>();

    for (const dataset of TABLE_DATASETS) {
        const pins = await tablePinsOf(dataDir, dataset);

        if (pins !== undefined) {
            const bytes = await readPinnedBytes(tableExtractPathOf(dataDir, dataset, pins), pins.extractSha256);

            extracts.set(dataset, parseSourceExtract(bytes));
        }
    }

    return extracts;
}

/**
 * Load and verify every committed input of the curated seed.
 *
 * @param dataDir - The seed data directory (`FS/src/foods/seed/data/`).
 * @returns The parsed inputs `composeSeedImage` takes.
 * @throws {SourcePinsFormatError} when `usda/sourcePins.json` or a table's pins file is not the pins shape.
 * @throws {SourcePinMismatchError} when a pinned file is absent or differs from its pin.
 * @throws {SeedRefusedError} when a committed file breaks the format.
 * @throws {BrandedExtractFormatError} when the Branded extract is not canonical.
 * @throws {SourceExtractFormatError} when a table extract is not canonical.
 * @throws {SeedRefusedError} when `sourceCandidates.tsv` breaks its format.
 * @sideEffect Reads the data directory.
 */
export async function loadSeedSources(dataDir: string): Promise<SeedInputs> {
    const usda = join(dataDir, 'usda');
    const pins = parseSourcePins(await readFile(join(usda, 'sourcePins.json'), 'utf8'));
    const extractBytes = await readPinnedBytes(join(usda, pins.brandedFoods.extract), pins.brandedFoods.extractSha256);
    const srItems = await readArchiveItems(
        join(usda, pins.srLegacy.file),
        pins.srLegacy.upstreamSha256,
        'sr_legacy_food',
    );
    const foundationItems = await readArchiveItems(
        join(usda, pins.foundation.file),
        pins.foundation.upstreamSha256,
        'foundation_food',
    );
    const [catalogText, changesText, candidatesText] = await Promise.all([
        readFile(join(dataDir, 'curatedCatalog.jsonl'), 'utf8'),
        readFile(join(dataDir, 'catalogChanges.json'), 'utf8'),
        readFile(join(dataDir, SOURCE_CANDIDATES_FILE), 'utf8'),
    ]);

    return {
        usdaItems: [...srItems, ...foundationItems],
        curated: parseCuratedSeed({ catalogText, changesText }),
        branded: parseBrandedExtract(extractBytes),
        extracts: await readTableExtracts(dataDir),
        candidates: parseSourceCandidates(candidatesText),
    };
}
