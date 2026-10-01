/**
 * Rebuild one table dataset's committed extract from its published files, by hand (plan U23, KTD-20).
 *
 * @pattern Composition Root — wires the dataset's pins, its candidates, the published files and its extractor
 *
 * The published files are not committed, so CI never runs this. It is the only proof that a committed extract is
 * what the pinned files hold, byte for byte: every published file is verified against its pin, the dataset's
 * candidate keys (`sourceCandidates.tsv`) are extracted and rendered, and the result is compared with the committed
 * extract (itself verified against `extractSha256`). A candidate key the files do not hold, or any difference, exits
 * non-zero.
 *
 * `--write` rewrites the extract instead and prints its SHA-256. ⛔ It never writes a pins file: a pin written by the
 * tool whose output it pins proves nothing. For a dataset's first extract, write its `sourcePins.json` by hand with the
 * published files' digests and any well-formed `extractSha256`, run `--write`, then set `extractSha256` by hand.
 *
 * Usage:
 *   npm run seed:table-extract --workspace=packages/services/food-service -- \
 *       --dataset cofid --upstream-dir <the directory holding the published files> [--write]
 *
 * @sideEffect Reads the published files and the committed seed; with `--write`, writes the extract.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { candidateKeysOf, parseSourceCandidates, SOURCE_CANDIDATES_FILE } from '../catalog/sourceCandidates.js';
import { isTableDataset } from '../citationDatasets.js';
import { tableExtractPathOf, tablePinsOf, tablePinsPathOf } from './tableExtractFiles.js';
import { rebuildTableExtract } from './tableExtractRebuild.js';
import { TABLE_EXTRACTORS } from './tableExtractors.js';
import { readPinnedBytes } from './usdaSourceArchive.js';

/** The committed seed data directory. */
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

/** @sideEffect The whole task. */
async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            dataset: { type: 'string' },
            'upstream-dir': { type: 'string' },
            write: { type: 'boolean', default: false },
        },
        allowPositionals: false,
    });
    const dataset = values.dataset;
    const upstreamDir = values['upstream-dir'];

    if (dataset === undefined || !isTableDataset(dataset) || upstreamDir === undefined) {
        throw new Error('Usage: --dataset <a table dataset> --upstream-dir <dir> [--write] (see the file header).');
    }

    const entry = TABLE_EXTRACTORS[dataset];

    if (entry.kind === 'awaitingUpstream') {
        throw new Error(`${dataset} has no extractor yet: ${entry.reason}`);
    }

    const pins = await tablePinsOf(DATA_DIR, dataset);

    if (pins === undefined) {
        throw new Error(`${dataset} has no pins in ${tablePinsPathOf(DATA_DIR, dataset)}. Write them by hand first.`);
    }

    const candidates = parseSourceCandidates(await readFile(join(DATA_DIR, SOURCE_CANDIDATES_FILE), 'utf8'));
    const keys = candidateKeysOf(candidates, dataset);
    const { text, missing } = await rebuildTableExtract({ pins, upstreamDir, extractor: entry.extractor, keys });

    if (missing.length > 0) {
        throw new Error(`${dataset}'s published files hold none of these candidate keys: ${missing.join(', ')}`);
    }

    process.stdout.write(`  ${String(keys.size)} ${dataset} candidates extracted\n`);

    const extractPath = tableExtractPathOf(DATA_DIR, dataset, pins);
    const sha = createHash('sha256').update(text).digest('hex');

    if (values.write) {
        await writeFile(extractPath, text);
        process.stdout.write(
            `  wrote ${extractPath} (sha256 ${sha}). Set extractSha256 in its sourcePins.json by hand.\n`,
        );

        return;
    }

    const committed = await readPinnedBytes(extractPath, pins.extractSha256);

    if (committed.toString('utf8') !== text) {
        process.stderr.write(`  ⛔ the rebuilt extract (sha256 ${sha}) differs from the committed ${extractPath}\n`);
        process.exitCode = 1;

        return;
    }

    process.stdout.write(`  ${extractPath} is reproduced byte for byte (sha256 ${sha})\n`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
