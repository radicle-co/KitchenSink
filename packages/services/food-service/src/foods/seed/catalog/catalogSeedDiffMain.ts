/**
 * `npm run catalog:diff -- --base <dir> --head <dir>` (curated catalog plan U5, KTD-11): plan the head's committed
 * seed against the base's projected seed and print the diff as Markdown, for CI's job summary.
 *
 * Both directories are seed data directories (`src/foods/seed/data/`). The base is read by `readDiffBase`, which
 * owns when it may be an empty catalog. A head that does not compose, and a plan the planner refuses, fail the command.
 *
 * Nothing here reaches a database or the network: both seeds are read from committed files.
 */
import { stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { readDiffBase } from './catalogDiffBase.js';
import { buildCatalogPlan } from './catalogPlanBuilder.js';
import { renderCatalogDiff } from './catalogSeedDiff.js';
import type { CatalogSnapshot } from './catalogSnapshot.js';
import { composeSeedImage } from './seedImage.js';
import { projectSeed } from './seedProjection.js';
import { loadSeedSources } from './seedSources.js';

/**
 * Whether a path is a directory.
 *
 * @sideEffect Stats the path.
 * @param dir - The path.
 * @returns `true` for an existing directory; `false` when nothing is there.
 * @throws Any failure but a missing path.
 */
async function isDirectory(dir: string): Promise<boolean> {
    try {
        return (await stat(dir)).isDirectory();
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

/**
 * Load, compose and project one committed seed.
 *
 * @sideEffect Reads the seed data directory.
 * @param dir - The seed data directory.
 * @returns Its projection.
 */
async function projectDir(dir: string): Promise<CatalogSnapshot> {
    return projectSeed(composeSeedImage(await loadSeedSources(dir)));
}

/** @sideEffect Reads both seed directories and writes the diff to stdout. */
async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: { base: { type: 'string' }, head: { type: 'string' } },
        allowPositionals: false,
    });

    if (values.base === undefined || values.head === undefined) {
        throw new Error('Usage: catalog:diff --base <seed data dir> --head <seed data dir>');
    }

    const headInputs = await loadSeedSources(values.head);
    const head = projectSeed(composeSeedImage(headInputs));
    const base = await readDiffBase(values.base, { exists: isDirectory, project: projectDir });
    const plan = buildCatalogPlan(head.content, base.snapshot, headInputs.curated.changes);

    process.stdout.write(renderCatalogDiff(plan, base.note === undefined ? {} : { note: base.note }));
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
