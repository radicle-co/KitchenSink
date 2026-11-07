import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCoverage } from './coverageTable.js';
import { flowCoverage } from './flowCoverage.js';
import { maestroFlowGraph } from './maestroFlows.js';
import { plannedFlows } from './plannedFlows.js';
import { FLOW_TABLE, MOBILE_PASS_THROUGH } from './repoModels.js';
import {
    checkScreens,
    parseScreenRecords,
    renderScreenCheck,
    type ScreenCheck,
    type ScreenRecord,
} from './screenCheck.js';

const MAESTRO = 'packages/apps/commise/mobile/.maestro';

/** One lane's record file and the platform it ran on. */
export interface ScreenSource {
    readonly platform: string;
    readonly file: string;
}

export interface ScreenReport {
    /** How many flows the run recorded a result for. Zero means the recorder did not run, and nothing was checked. */
    readonly flows: number;
    /** True when a flow saw a screen its row lacks, or passed having recorded nothing. A wider row never fails. */
    readonly failed: boolean;
    readonly text: string;
    readonly checks: readonly { readonly platform: string; readonly check: ScreenCheck }[];
}

/**
 * Checks lanes' record files against a registry. Lanes of one platform run different flows, so their files join.
 *
 * @sideEffect Reads the record files; a file that does not exist counts as a lane that ran no flow.
 * @param sources - Each lane's file and platform.
 * @param coverage - Each flow's combined row.
 * @param branching - The flows that have `when:` branches.
 * @returns The report, with the text to print.
 * @throws When a file is not a record file.
 */
export function checkScreenFiles(
    sources: readonly ScreenSource[],
    coverage: ReadonlyMap<string, ReadonlySet<string>>,
    branching: ReadonlySet<string>,
): ScreenReport {
    const byPlatform = new Map<string, ScreenRecord[]>();

    for (const { platform, file } of sources) {
        const records = existsSync(file) ? parseScreenRecords(readFileSync(file, 'utf8'), file) : [];
        byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), ...records]);
    }

    const checks = [...byPlatform].map(([platform, records]) => ({
        platform,
        records,
        check: checkScreens({ records, coverage, branching }),
    }));

    return {
        flows: checks.reduce(
            (sum, { records }) => sum + new Set(records.filter((r) => r.kind === 'result').map((r) => r.flow)).size,
            0,
        ),
        failed: checks.some(({ check }) => check.missing.length > 0 || check.silent.length > 0),
        text: checks.map(({ platform, check }) => renderScreenCheck(check, platform)).join(''),
        checks: checks.map(({ platform, check }) => ({ platform, check })),
    };
}

/**
 * After a run: checks the screens it recorded against the registry in the repository.
 *
 * @sideEffect Reads the registry, the flows, the record files, and runs the runner's pure `plan` subcommand.
 * @param repo - The repository root.
 * @param sources - Each lane's record file and platform.
 * @returns The report.
 */
export function checkRecordedScreens(repo: string, sources: readonly ScreenSource[]): ScreenReport {
    const files = globSync(`${MAESTRO}/**/*`, { cwd: repo }).sort();
    const read = (path: string): string => readFileSync(join(repo, path), 'utf8');
    const flows = maestroFlowGraph({ dir: MAESTRO, files, read, topLevel: plannedFlows(repo) });
    const table = parseCoverage(read(FLOW_TABLE), FLOW_TABLE);
    const idOf = (file: string): string => file.slice(`${MAESTRO}/`.length).replace(/\.ya?ml$/u, '');
    const coverage = flowCoverage({ flows, table, idOf, passThrough: MOBILE_PASS_THROUGH });
    const branching = new Set(
        [...flows.tests].flatMap(([file, id]) =>
            [file, ...flows.runsOf(file)].some((path) => /^\s*when:/mu.test(read(path))) ? [id] : [],
        ),
    );

    return checkScreenFiles(sources, coverage, branching);
}
