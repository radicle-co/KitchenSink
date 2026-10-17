/**
 * Rebuild the committed Branded extract from the pinned upstream archive, by hand (plan U1, KTD-20).
 *
 * @pattern Composition Root — wires the pinned archive, the curated catalog's citations and the extractor
 *
 * The Branded Foods download is 449 MB and is not committed, so CI never runs this. It is the only proof that
 * the committed extract is what the pinned download holds, byte for byte: the upstream zip is verified against
 * `brandedFoods.upstreamSha256`, every `usdaBranded` candidate of `sourceCandidates.tsv` is extracted and rendered (a
 * candidate the policy did not pick still has to be readable, or the policy cannot compare it), and the result is
 * compared with the committed extract (itself verified against `brandedFoods.extractSha256`). A candidate the archive
 * does not hold, or any difference, exits non-zero.
 *
 * `--write` rewrites the extract instead and prints its SHA-256. ⛔ It never writes `sourcePins.json`: a pin
 * written by the tool whose output it pins proves nothing, so the pin is a deliberate human edit.
 *
 * Usage:
 *   npm run seed:branded-extract --workspace=packages/services/food-service -- \
 *       --upstream …/FoodData_Central_branded_food_csv_2026-04-30.zip [--write]
 *
 * @sideEffect Reads the upstream archive (about 3 GB of CSV) and the committed candidates; with `--write`, writes
 *   the extract.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { fdcIdOf, isFdcKey } from '../catalogKey.js';
import { candidateKeysOf, parseSourceCandidates, SOURCE_CANDIDATES_FILE } from '../catalog/sourceCandidates.js';
import { extractBrandedProducts, renderBrandedExtract } from './brandedExtract.js';
import { parseSourcePins, readPinnedBytes, zipEntrySource } from './usdaSourceArchive.js';

/** The committed seed data directory. */
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

/**
 * The FDC ids `sourceCandidates.tsv` lists as Branded products.
 *
 * @returns The candidate ids.
 * @sideEffect Reads the committed candidates.
 */
async function candidateProducts(): Promise<ReadonlySet<number>> {
    const candidates = parseSourceCandidates(await readFile(join(DATA_DIR, SOURCE_CANDIDATES_FILE), 'utf8'));

    return new Set([...candidateKeysOf(candidates, 'usdaBranded')].filter(isFdcKey).map(fdcIdOf));
}

/** @sideEffect The whole task. */
async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: { upstream: { type: 'string' }, write: { type: 'boolean', default: false } },
        allowPositionals: false,
    });

    if (values.upstream === undefined) {
        throw new Error('Missing --upstream <the Branded Foods zip> (see the file header).');
    }

    const pins = parseSourcePins(await readFile(join(DATA_DIR, 'usda', 'sourcePins.json'), 'utf8'));
    const extractPath = join(DATA_DIR, 'usda', pins.brandedFoods.extract);
    const wanted = await candidateProducts();
    const source = await zipEntrySource(await readPinnedBytes(values.upstream, pins.brandedFoods.upstreamSha256));
    let text: string;

    try {
        const products = await extractBrandedProducts(source, wanted);
        const found = new Set(products.map((product) => product.fdcId));
        const missing = [...wanted].filter((id) => !found.has(id)).sort((left, right) => left - right);

        if (missing.length > 0) {
            throw new Error(`The Branded archive holds none of these candidate products: ${missing.join(', ')}`);
        }

        process.stdout.write(`  ${String(products.length)} Branded candidates extracted\n`);
        text = renderBrandedExtract(products);
    } finally {
        source.close();
    }

    const sha = createHash('sha256').update(text).digest('hex');

    if (values.write) {
        await writeFile(extractPath, text);
        process.stdout.write(
            `  wrote ${extractPath} (sha256 ${sha}). Set brandedFoods.extractSha256 in sourcePins.json by hand.\n`,
        );

        return;
    }

    const committed = await readPinnedBytes(extractPath, pins.brandedFoods.extractSha256);

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
