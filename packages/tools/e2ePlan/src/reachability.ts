/**
 * Walks an import graph backwards from a changed file to the screens and tests that depend on it.
 *
 * Pure: the graph arrives as a function, so the walk is tested without one.
 */

/** The places a backwards walk can end. */
export interface Terminals {
    /** A file that IS a screen (or part of one) to the screens it belongs to. A layout belongs to many. */
    readonly screenEntries: ReadonlyMap<string, readonly string[]>;
    /** Files whose change can alter every screen: reaching one means the whole app. */
    readonly roots: ReadonlySet<string>;
    /** A test file to the id of the test it is. */
    readonly tests: ReadonlyMap<string, string>;
}

export interface Reached {
    readonly screens: ReadonlySet<string>;
    readonly tests: ReadonlySet<string>;
    /** The roots reached, which is why the whole app is affected. */
    readonly roots: readonly string[];
}

/**
 * What changed in a file the walk has reached.
 *
 * - a set of names: only those exports changed, which only a re-export edge can know;
 * - `all`: any export may have changed;
 * - `effectful`: the code that runs when the file loads changed, so every importer is affected whatever it takes.
 */
export type Changed = ReadonlySet<string> | 'all' | 'effectful';

/**
 * Where a change goes next: for a reached file and what changed in it, the files that import it, each with what
 * changed in THEM. A file missing from the answer is not affected.
 */
export type Step = (file: string, changed: Changed) => ReadonlyMap<string, Changed>;

/**
 * The step that ignores names: every importer is affected completely. The Maestro flow graph uses it, and so does any
 * edge nothing narrows.
 *
 * @param importersOf - The files that import a file.
 * @returns The step.
 */
export const fileLevel =
    (importersOf: (file: string) => readonly string[]): Step =>
    (file) =>
        new Map(importersOf(file).map((importer) => [importer, 'all' as const]));

const rank = (changed: Changed): number => (changed === 'effectful' ? 2 : changed === 'all' ? 1 : 0);

/**
 * The least change that holds both. An effectful change holds everything, `all` holds any set of names.
 *
 * @param left - One change.
 * @param right - Another.
 * @returns Their join.
 */
export function joinChanged(left: Changed, right: Changed): Changed {
    if (rank(left) !== rank(right) || typeof left === 'string' || typeof right === 'string') {
        return rank(left) >= rank(right) ? left : right;
    }

    return new Set([...left, ...right]);
}

/** Whether `next` holds something `seen` does not. */
const grows = (seen: Changed, next: Changed): boolean =>
    typeof next === 'string' || typeof seen === 'string'
        ? rank(next) > rank(seen)
        : [...next].some((name) => !seen.has(name));

/**
 * Finds what a change to `file` can affect.
 *
 * A screen's importers are followed too, because one screen may embed another. The one importer that is NOT
 * followed from a screen is a root: the navigator imports every screen to register it, and following that edge
 * would make every screen change reach the root and select everything.
 *
 * A file is visited again when a later path brings it more of what changed, so a barrel reached from two files by two
 * different names keeps both.
 *
 * @param file - The changed file.
 * @param step - Where a change goes next.
 * @param terminals - Where a walk ends.
 * @param start - What changed in `file`: all of it, unless the caller knows better.
 * @returns The screens, tests and roots reached.
 */
export function reach(file: string, step: Step, terminals: Terminals, start: Changed = 'all'): Reached {
    const screens = new Set<string>();
    const tests = new Set<string>();
    const roots = new Set<string>();
    const seen = new Map<string, Changed>([[file, start]]);
    const queue: string[] = [file];

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const entryOf = terminals.screenEntries.get(next);
        const testId = terminals.tests.get(next);

        if (terminals.roots.has(next)) {
            roots.add(next);

            continue;
        }

        entryOf?.forEach((screen) => screens.add(screen));

        if (testId !== undefined) {
            tests.add(testId);

            continue;
        }

        for (const [importer, changed] of step(next, seen.get(next) ?? 'all')) {
            const registers = entryOf !== undefined && terminals.roots.has(importer);
            const before = seen.get(importer);

            if (!registers && (before === undefined || grows(before, changed))) {
                seen.set(importer, before === undefined ? changed : joinChanged(before, changed));
                queue.push(importer);
            }
        }
    }

    return { screens, tests, roots: [...roots].sort() };
}
