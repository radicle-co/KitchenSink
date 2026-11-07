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
 * Finds what a change to `file` can affect.
 *
 * A screen's importers are followed too, because one screen may embed another. The one importer that is NOT
 * followed from a screen is a root: the navigator imports every screen to register it, and following that edge
 * would make every screen change reach the root and select everything.
 *
 * @param file - The changed file.
 * @param importersOf - The files that import a file.
 * @param terminals - Where a walk ends.
 * @returns The screens, tests and roots reached.
 */
export function reach(file: string, importersOf: (file: string) => readonly string[], terminals: Terminals): Reached {
    const screens = new Set<string>();
    const tests = new Set<string>();
    const roots = new Set<string>();
    const seen = new Set<string>([file]);
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

        for (const importer of importersOf(next)) {
            const registers = entryOf !== undefined && terminals.roots.has(importer);

            if (!registers && !seen.has(importer)) {
                seen.add(importer);
                queue.push(importer);
            }
        }
    }

    return { screens, tests, roots: [...roots].sort() };
}
