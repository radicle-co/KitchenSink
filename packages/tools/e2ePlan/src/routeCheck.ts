/**
 * Compares the routes a run RECORDED with the screens each spec's registry row names.
 *
 * The registry is a lower bound read from source; a click that lands on another screen is invisible to it. The
 * recorder (`web/tests/e2e/utils/routeRecorder.ts`) sees where each spec really went, and this finds the rows that
 * leave a visited screen out. It only ever asks for a row to GROW: shrinking a row on the evidence of one run would
 * trade a test that runs for one that does not, which is the failure the selector exists to avoid.
 */
import type { CoverageTable } from './coverageTable.js';
import { matchRoute } from './webRoutes.js';

/** One navigation a spec made: the spec's path under `tests/e2e`, and the locale-free path it reached. */
export interface RecordedRoute {
    readonly spec: string;
    readonly path: string;
}

export interface MissingRow {
    readonly spec: string;
    /** Screens to add to the spec's row, sorted. */
    readonly screens: readonly string[];
}

/**
 * Reads a lane's record file.
 *
 * @param text - JSON Lines text.
 * @param label - The file's name, for error messages.
 * @returns The records.
 * @throws When a line is not a record: a reader that skipped it would read damage as "the spec went nowhere".
 */
export function parseRecords(text: string, label: string): readonly RecordedRoute[] {
    return text.split('\n').flatMap((line, index): RecordedRoute[] => {
        if (line.trim() === '') {
            return [];
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(line);
        } catch {
            throw new Error(`${label} line ${index + 1}: not JSON`);
        }

        const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

        if (typeof record['spec'] !== 'string' || typeof record['path'] !== 'string') {
            throw new Error(`${label} line ${index + 1}: a record is { spec, path }`);
        }

        return [{ spec: record['spec'], path: record['path'] }];
    });
}

/**
 * Finds the rows that leave out a screen their spec was seen on.
 *
 * @param records - What the run recorded.
 * @param table - The spec registry.
 * @param screens - The screens that exist.
 * @returns One entry per spec with screens to add.
 */
export function missingRows(
    records: readonly RecordedRoute[],
    table: CoverageTable,
    screens: readonly string[],
): readonly MissingRow[] {
    const seen = new Map<string, Set<string>>();

    for (const record of records) {
        const screen = matchRoute(screens, record.path);

        if (screen !== undefined && record.spec.endsWith('.spec.ts')) {
            seen.set(record.spec, (seen.get(record.spec) ?? new Set()).add(screen));
        }
    }

    return [...seen]
        .flatMap(([spec, reached]): MissingRow[] => {
            const row = table.get(spec) ?? new Set<string>();
            const missing = row.has('*') ? [] : [...reached].filter((screen) => !row.has(screen)).sort();

            return missing.length > 0 ? [{ spec, screens: missing }] : [];
        })
        .sort((a, b) => a.spec.localeCompare(b.spec));
}

/**
 * The exact additions to make.
 *
 * @param rows - The missing rows.
 * @returns Text, one spec per line; empty when nothing is missing.
 */
export const renderMissingRows = (rows: readonly MissingRow[]): string =>
    rows.map((row) => `${row.spec}: add ${row.screens.join(', ')} to its row in specScreens.tsv\n`).join('');
