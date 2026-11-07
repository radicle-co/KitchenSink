import type { CoverageTable } from './coverageTable.js';

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
    a.size === b.size && [...a].every((screen) => b.has(screen));

/**
 * The tests whose registry row is new or different, which is what a change to the registry file affects.
 *
 * @param before - The table at the merge base, or undefined when the file is new.
 * @param after - The table now.
 * @returns Sorted ids of rows added or changed. A removed row names nothing: its test is gone.
 */
export function changedRows(before: CoverageTable | undefined, after: CoverageTable): readonly string[] {
    return [...after]
        .filter(([id, screens]) => {
            const old = before?.get(id);

            return old === undefined || !same(old, screens);
        })
        .map(([id]) => id)
        .sort();
}
