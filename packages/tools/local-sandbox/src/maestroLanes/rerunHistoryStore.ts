/**
 * The file behind the rerun limit: `<state root>/localMaestro/rerunHistory.json`. The door reads it once after it has
 * the host lock and writes it once when the lanes are done, so the host lock is what serialises two doors.
 *
 * @sideEffect Reads and writes one file under the state folder.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EMPTY_RERUN_HISTORY, rerunHistorySchema, type RerunHistory } from './rerunLimit.js';

/**
 * The history on disk.
 *
 * @param file - The history file.
 * @param report - Called once with a line when the file exists and cannot be used. It is never a crash: the cost of a
 *   lost history is one rerun too many, and a refused door over a torn file would block every run.
 * @returns The history, or an empty one for a missing or unusable file.
 * @sideEffect Reads the file.
 */
export function readRerunHistory(file: string, report: (line: string) => void): RerunHistory {
    let text: string;

    try {
        text = readFileSync(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return EMPTY_RERUN_HISTORY;
        }

        report(`maestro:lanes: ${file} could not be read (${String(error)}); the rerun history starts empty`);

        return EMPTY_RERUN_HISTORY;
    }

    try {
        return rerunHistorySchema.parse(JSON.parse(text));
    } catch (error) {
        report(`maestro:lanes: ${file} is not a rerun history (${String(error)}); it starts empty`);

        return EMPTY_RERUN_HISTORY;
    }
}

/**
 * Replace the file with `history`, mode 0600, through a temp file in the same folder and a rename: a reader sees the
 * old file or the new one, never half of one.
 *
 * @param file - The history file. Its folder is made when missing.
 * @param history - What to keep.
 * @sideEffect Writes a temp file, then renames it over `file`.
 */
export function writeRerunHistory(file: string, history: RerunHistory): void {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${String(process.pid)}.tmp`;

    writeFileSync(temp, `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
    // `mode` above is masked by the umask and ignored for a file that exists: say it again.
    chmodSync(temp, 0o600);
    renameSync(temp, file);
}
