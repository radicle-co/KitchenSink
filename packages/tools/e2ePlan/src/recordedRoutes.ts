import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCoverage, type CoverageTable } from './coverageTable.js';
import { SPEC_TABLE } from './repoModels.js';
import { missingRows, parseRecords, renderMissingRows, type MissingRow } from './routeCheck.js';
import { webRegistry } from './webRoutes.js';

const WEB = 'packages/apps/commise/web';

export interface RouteCheck {
    /** How many navigations the run recorded. Zero means the recorder did not run, and nothing was checked. */
    readonly recorded: number;
    readonly missing: readonly MissingRow[];
}

/**
 * Checks the records in a folder against a registry.
 *
 * @sideEffect Reads the `.jsonl` files of the folder.
 * @param dir - The folder the lanes wrote their records to.
 * @param registry - The spec table and the screens.
 * @returns How many navigations were recorded and which rows must grow.
 */
export function checkRecordsInDir(
    dir: string,
    registry: { readonly table: CoverageTable; readonly screens: readonly string[] },
): RouteCheck {
    if (!existsSync(dir)) {
        return { recorded: 0, missing: [] };
    }

    const records = globSync('*.jsonl', { cwd: dir })
        .sort()
        .flatMap((file) => parseRecords(readFileSync(join(dir, file), 'utf8'), file));

    return { recorded: records.length, missing: missingRows(records, registry.table, registry.screens) };
}

/**
 * After a run: checks the routes it recorded against the web registry, and says what to add.
 *
 * @sideEffect Reads the repository's registry and app folder, and the record files.
 * @param repo - The repository root.
 * @param dir - The folder the lanes wrote their records to.
 * @returns The check, and the text to print when a row must grow.
 */
export function checkRecordedRoutes(repo: string, dir: string): RouteCheck & { readonly text: string } {
    const appDir = `${WEB}/src/app`;
    const registry = webRegistry({ appDir, extraRoots: [], files: globSync(`${appDir}/**/*`, { cwd: repo }) });
    const table = parseCoverage(readFileSync(join(repo, SPEC_TABLE), 'utf8'), SPEC_TABLE);
    const check = checkRecordsInDir(dir, { table, screens: registry.screens });

    return { ...check, text: renderMissingRows(check.missing) };
}
