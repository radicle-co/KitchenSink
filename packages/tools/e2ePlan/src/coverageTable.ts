/**
 * The registry that says which screens each end-to-end test passes through, and the checks that keep it honest.
 *
 * A row is a test id, a tab, and a comma-separated list of screens. A row must list EVERY screen the test reaches,
 * the ones it only passes through included: a screen left out is a screen whose change does not run that test.
 * The one row that says "any screen" is `*`.
 */
import { matchRoute } from './webRoutes.js';
import type { RouteLiterals } from './routeLiterals.js';

export type CoverageTable = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Reads a coverage table.
 *
 * @param text - The file's text.
 * @param label - The file's name, for error messages.
 * @returns Test id to its screens.
 * @throws When a row is malformed or a test has two rows.
 */
export function parseCoverage(text: string, label: string): CoverageTable {
    const table = new Map<string, ReadonlySet<string>>();

    for (const [index, line] of text.split('\n').entries()) {
        if (line.trim() === '' || line.startsWith('#')) {
            continue;
        }

        const [id, screens, ...extra] = line.split('\t');
        const where = `${label} line ${index + 1}`;

        if (id === undefined || screens === undefined || extra.length > 0 || id.trim() === '') {
            throw new Error(`${where}: a row is a test id, a tab and a list of screens`);
        }

        const list = screens
            .split(',')
            .map((screen) => screen.trim())
            .filter((screen) => screen !== '');

        if (list.length === 0) {
            throw new Error(`${where}: ${id} lists no screens`);
        }

        if (table.has(id)) {
            throw new Error(`${where}: ${id} has a row twice`);
        }

        table.set(id, new Set(list));
    }

    return table;
}

/**
 * Checks the table against what exists.
 *
 * @param input - The tests that exist, the screens that exist, and the table.
 * @returns One problem per test with no row, row with no test, and row naming a screen that does not exist.
 */
export function checkCoverage(input: {
    readonly tests: readonly string[];
    readonly screens: readonly string[];
    readonly table: CoverageTable;
}): readonly string[] {
    const tests = new Set(input.tests);
    const screens = new Set(input.screens);
    const problems: string[] = [];

    for (const id of input.tests) {
        if (!input.table.has(id)) {
            problems.push(`${id} has no row`);
        }
    }

    for (const [id, row] of input.table) {
        if (!tests.has(id)) {
            problems.push(`${id} has a row but no such test exists`);
        }

        for (const screen of row) {
            if (screen !== '*' && !screens.has(screen)) {
                problems.push(`${id} names ${screen}, which is not a screen`);
            }
        }
    }

    return problems;
}

/**
 * Checks one test's row against the paths its source navigates to.
 *
 * @param input - The test's row, the screens, and what its source visits.
 * @returns One problem per visited screen the row leaves out, and one when a path cannot be read and the row is not `*`.
 */
export function uncoveredRoutes(input: {
    readonly row: ReadonlySet<string>;
    readonly screens: readonly string[];
    readonly visited: RouteLiterals;
}): readonly string[] {
    if (input.row.has('*')) {
        return [];
    }

    const problems: string[] = [];

    if (input.visited.dynamic) {
        problems.push('it navigates to a path the source does not state, so its row must be * (every screen)');
    }

    for (const path of input.visited.paths) {
        // A path no screen serves reaches only the not-found page, which is a root: nothing to list.
        const screen = matchRoute(input.screens, path);

        if (screen !== undefined && !input.row.has(screen)) {
            problems.push(`it visits ${path}, so its row must list ${screen}`);
        }
    }

    return problems;
}
