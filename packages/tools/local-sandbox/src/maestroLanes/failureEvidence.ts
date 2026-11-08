/**
 * Where a lane keeps the debug folder of a flow that failed, and how old ones are pruned.
 *
 * The runner (`runMaestroFlows.sh`, `maestro_keep_debug_folder`) copies a failed flow's Maestro folder (screenshots, view
 * hierarchy, command trace, Maestro log) and its device log into `MAESTRO_EVIDENCE_DIR` as it fails, so they outlive the
 * device and the Mac's lane folders. A passed flow keeps nothing.
 *
 * @sideEffect {@link pruneFailureRuns} deletes folders.
 */
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** The folder name under a lane's state folder that holds failure evidence, one subfolder per run. */
export const FAILURE_FOLDER = 'failed';

/** How many earlier runs' failure folders a lane keeps. A run that fails often is the one worth reading back. */
export const FAILURE_RUNS_KEPT = 5;

/** Where one run's failed flows are kept for a lane. Pure. */
export const failureEvidenceDir = (laneStateDir: string, runStamp: string): string =>
    path.join(laneStateDir, FAILURE_FOLDER, runStamp);

/**
 * Delete all but the newest {@link FAILURE_RUNS_KEPT} run folders of a lane. Run folders are named by start time, so the
 * name order is the age order. Nothing happens when the lane has none.
 *
 * @sideEffect Deletes folders under `<laneStateDir>/failed`.
 */
export function pruneFailureRuns(laneStateDir: string): void {
    const root = path.join(laneStateDir, FAILURE_FOLDER);
    let runs: string[];

    try {
        runs = readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        return;
    }

    for (const old of runs.slice(0, Math.max(0, runs.length - FAILURE_RUNS_KEPT))) {
        rmSync(path.join(root, old), { recursive: true, force: true });
    }
}
