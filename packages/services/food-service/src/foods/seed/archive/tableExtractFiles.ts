/**
 * Where a table dataset's pins and extract live in the seed data directory (plan U23): FNDDS's entry sits in
 * `usda/sourcePins.json`, every other table has `<source>/sourcePins.json`, and an extract sits beside its pins.
 * The seed load and the hand-run rebuild both ask here, so the two cannot disagree about a file's place.
 *
 * @module
 */
import { join } from 'node:path';

import { TABLE_DATASET_SOURCE, type TableDataset } from '../citationDatasets.js';
import { readTextIfPresent } from './committedFile.js';
import { parseTableExtractPins, type TableExtractPins } from './tableExtractPins.js';
import { parseSourcePins } from './usdaSourceArchive.js';

/**
 * The path of a table dataset's pins file. Pure.
 *
 * @param dataDir - The seed data directory.
 * @param dataset - The table dataset.
 * @returns `usda/sourcePins.json` for FNDDS, `<source>/sourcePins.json` for every other table.
 */
export function tablePinsPathOf(dataDir: string, dataset: TableDataset): string {
    return join(dataDir, TABLE_DATASET_SOURCE[dataset], 'sourcePins.json');
}

/**
 * A table dataset's pins: FNDDS's entry of `usda/sourcePins.json`, or `<source>/sourcePins.json`.
 *
 * @param dataDir - The seed data directory.
 * @param dataset - The table dataset.
 * @returns The pins, or `undefined` when the dataset has no pins and so no extract. A candidate naming such a dataset
 *   is refused by the image as `candidateNotInExtract`, so an absent file cannot pass unnoticed.
 * @throws {SourcePinsFormatError} when the file is not the shape.
 * @sideEffect Reads the dataset's pins file.
 */
export async function tablePinsOf(dataDir: string, dataset: TableDataset): Promise<TableExtractPins | undefined> {
    const text = await readTextIfPresent(tablePinsPathOf(dataDir, dataset));

    if (text === undefined) {
        return undefined;
    }

    return dataset === 'usdaFndds' ? parseSourcePins(text).fndds : parseTableExtractPins(text);
}

/**
 * The path of a table dataset's committed extract. Pure.
 *
 * @param dataDir - The seed data directory.
 * @param dataset - The table dataset.
 * @param pins - The dataset's pins.
 * @returns The extract's path, beside the pins.
 */
export function tableExtractPathOf(dataDir: string, dataset: TableDataset, pins: TableExtractPins): string {
    return join(dataDir, TABLE_DATASET_SOURCE[dataset], pins.extract);
}
